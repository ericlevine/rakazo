#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: provision-load-balancer.sh PROJECT_ID ZONE INSTANCE HOSTNAME [IAP_MEMBER...]

Example (placeholders only):
  provision-load-balancer.sh your-project-id us-west2-a rakazo \
    rakazo.example.com user:operator@example.com group:team@example.com

The VM must already run configure-host-proxy.sh. IAP_MEMBER values receive
roles/iap.httpsResourceAccessor on this backend only.
EOF
}

if [[ $# -lt 4 ]]; then
  usage >&2
  exit 2
fi

project_id=$1
zone=$2
instance=$3
hostname=$4
shift 4

prefix="${instance}-iap"
group="${prefix}-ig"
health_check="${prefix}-health"
backend="${prefix}-backend"
address="${prefix}-ip"
certificate="${prefix}-certificate"
url_map="${prefix}-url-map"
proxy="${prefix}-https-proxy"
forwarding_rule="${prefix}-https"
network=$(gcloud compute instances describe "${instance}" --project="${project_id}" \
  --zone="${zone}" --format='value(networkInterfaces[0].network.basename())')

gcloud services enable compute.googleapis.com iap.googleapis.com \
  cloudresourcemanager.googleapis.com --project="${project_id}"

if ! gcloud compute instance-groups unmanaged describe "${group}" --project="${project_id}" \
  --zone="${zone}" >/dev/null 2>&1; then
  gcloud compute instance-groups unmanaged create "${group}" --project="${project_id}" --zone="${zone}"
fi
gcloud compute instance-groups unmanaged add-instances "${group}" --project="${project_id}" \
  --zone="${zone}" --instances="${instance}"
gcloud compute instance-groups unmanaged set-named-ports "${group}" --project="${project_id}" \
  --zone="${zone}" --named-ports=http:8080

if ! gcloud compute health-checks describe "${health_check}" --project="${project_id}" >/dev/null 2>&1; then
  gcloud compute health-checks create http "${health_check}" --project="${project_id}" \
    --port=8080 --request-path=/health
fi

if ! gcloud compute backend-services describe "${backend}" --project="${project_id}" \
  --global >/dev/null 2>&1; then
  gcloud compute backend-services create "${backend}" --project="${project_id}" --global \
    --load-balancing-scheme=EXTERNAL_MANAGED --protocol=HTTP --port-name=http \
    --health-checks="${health_check}"
  gcloud compute backend-services add-backend "${backend}" --project="${project_id}" --global \
    --instance-group="${group}" --instance-group-zone="${zone}"
fi
gcloud compute backend-services update "${backend}" --project="${project_id}" --global --iap=enabled

if ! gcloud compute firewall-rules describe "${prefix}-allow-gfe" --project="${project_id}" >/dev/null 2>&1; then
  gcloud compute firewall-rules create "${prefix}-allow-gfe" --project="${project_id}" \
    --network="${network}" --direction=INGRESS --action=ALLOW --rules=tcp:8080 \
    --source-ranges=35.191.0.0/16,130.211.0.0/22 --target-tags="${prefix}-backend"
fi
gcloud compute instances add-tags "${instance}" --project="${project_id}" --zone="${zone}" \
  --tags="${prefix}-backend"

if ! gcloud compute addresses describe "${address}" --project="${project_id}" --global >/dev/null 2>&1; then
  gcloud compute addresses create "${address}" --project="${project_id}" --global --ip-version=IPV4
fi
if ! gcloud compute ssl-certificates describe "${certificate}" --project="${project_id}" --global >/dev/null 2>&1; then
  gcloud compute ssl-certificates create "${certificate}" --project="${project_id}" --global \
    --domains="${hostname}"
fi
if ! gcloud compute url-maps describe "${url_map}" --project="${project_id}" >/dev/null 2>&1; then
  gcloud compute url-maps create "${url_map}" --project="${project_id}" \
    --default-service="${backend}"
fi
if ! gcloud compute target-https-proxies describe "${proxy}" --project="${project_id}" >/dev/null 2>&1; then
  gcloud compute target-https-proxies create "${proxy}" --project="${project_id}" \
    --ssl-certificates="${certificate}" --url-map="${url_map}"
fi
if ! gcloud compute forwarding-rules describe "${forwarding_rule}" --project="${project_id}" --global >/dev/null 2>&1; then
  gcloud compute forwarding-rules create "${forwarding_rule}" --project="${project_id}" --global \
    --load-balancing-scheme=EXTERNAL_MANAGED --network-tier=PREMIUM --ports=443 \
    --address="${address}" --target-https-proxy="${proxy}"
fi

for member in "$@"; do
  gcloud iap web add-iam-policy-binding --project="${project_id}" \
    --resource-type=backend-services --service="${backend}" \
    --member="${member}" --role=roles/iap.httpsResourceAccessor >/dev/null
done

project_number=$(gcloud projects describe "${project_id}" --format='value(projectNumber)')
backend_id=$(gcloud compute backend-services describe "${backend}" --project="${project_id}" \
  --global --format='value(id)')
ip=$(gcloud compute addresses describe "${address}" --project="${project_id}" \
  --global --format='value(address)')

cat <<EOF
Load balancer resources are ready.
DNS: point ${hostname} to ${ip}
IAP_AUDIENCE=/projects/${project_number}/global/backendServices/${backend_id}
HTTPS certificate activation can take several minutes after DNS resolves.
EOF
