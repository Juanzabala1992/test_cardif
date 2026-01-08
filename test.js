const { execSync } = require("child_process");

function run(cmd, name) {
  try {
    const out = execSync(cmd, { encoding: "utf8" }).trim();
    console.log(`[OK] ${name}: ${out}`);
    return true;
  } catch (e) {
    const stdout = e.stdout ? e.stdout.toString() : "";
    const stderr = e.stderr ? e.stderr.toString() : "";
    console.error(`[FAIL] ${name}: Command failed: ${cmd}`);
    if (stdout) console.error(stdout.trim());
    if (stderr) console.error(stderr.trim());
    return false;
  }
}

function exists(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

console.log("=== Smoke test Node + Chrome/Edge ===");
console.log(`[INFO] Node: ${process.version}`);

const chromeEnv = process.env.CHROME_BIN;
const edgeEnv = process.env.EDGE_BIN;

// defaults “oficiales”
const chromeDefault = "google-chrome-stable";
const edgeDefault = "microsoft-edge-stable";

// decide qué probar, basado en lo que realmente existe en la imagen
let testedAny = false;

// Chrome (solo si existe el binario)
const chromeCandidate = chromeEnv || chromeDefault;
console.log(`[INFO] CHROME_BIN: ${chromeEnv || "(not set)"} (candidate: ${chromeCandidate})`);
if (exists(chromeCandidate)) {
  testedAny = true;
  const ok = run(`${chromeCandidate} --version`, "Google Chrome");
  if (!ok) process.exit(1);
} else {
  console.log(`[SKIP] Google Chrome: ${chromeCandidate} not found in image`);
}

// Edge (solo si existe el binario)
const edgeCandidate = edgeEnv || edgeDefault;
console.log(`[INFO] EDGE_BIN: ${edgeEnv || "(not set)"} (candidate: ${edgeCandidate})`);
if (exists(edgeCandidate)) {
  testedAny = true;
  const ok = run(`${edgeCandidate} --version`, "Microsoft Edge");
  if (!ok) process.exit(1);
} else {
  console.log(`[SKIP] Microsoft Edge: ${edgeCandidate} not found in image`);
}

if (!testedAny) {
  console.error("[FAIL] No browsers found (neither Chrome nor Edge).");
  process.exit(1);
}

console.log("✅ Todo OK");



****************

  #!/usr/bin/env bash
set -euo pipefail

# --- Config ---
PATTERN='col-c-dev|dv'
OUT_FILE="reporte_namespaces.txt"

# --- Helpers: sumar CPU/Mem desde "oc adm top pods" ---
sum_usage() {
  local ns="$1"

  # Si no hay métricas o falla, retornamos vacío y el caller pondrá N/A
  oc adm top pods -n "$ns" --no-headers 2>/dev/null | awk '
    function cpu_to_m(x){
      # "50m" -> 50
      if (x ~ /m$/) { sub(/m$/,"",x); return x+0 }
      # "0.2" (cores) -> 200m
      return (x+0)*1000
    }
    function mem_to_mi(x){
      # Ki/Mi/Gi/Ti -> Mi
      if (x ~ /Ki$/) { sub(/Ki$/,"",x); return (x+0)/1024 }
      if (x ~ /Mi$/) { sub(/Mi$/,"",x); return x+0 }
      if (x ~ /Gi$/) { sub(/Gi$/,"",x); return (x+0)*1024 }
      if (x ~ /Ti$/) { sub(/Ti$/,"",x); return (x+0)*1024*1024 }
      return x+0
    }
    { cpu+=cpu_to_m($2); mem+=mem_to_mi($3) }
    END {
      # imprime: CPU(m) \t MEM(Mi)
      if (NR>0) printf "%.0f\t%.0f\n", cpu, mem
    }
  '
}

# --- Obtener namespaces filtrados (desde namespaces reales) ---
mapfile -t NAMESPACES < <(oc get ns -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | grep -E "$PATTERN" || true)

# --- Header del reporte ---
{
  echo -e "NAMESPACE\tCPU(m)\tMEM(Mi)\tCREATED_AT\tREQUESTER"
  echo -e "---------\t------\t-------\t----------\t---------"
} > "$OUT_FILE"

# --- Loop ---
for ns in "${NAMESPACES[@]}"; do
  created="$(oc get ns "$ns" -o jsonpath='{.metadata.creationTimestamp}' 2>/dev/null || echo 'N/A')"
  requester="$(oc get project "$ns" -o jsonpath='{.metadata.annotations.openshift\.io/requester}' 2>/dev/null || echo 'N/A')"

  usage="$(sum_usage "$ns" || true)"
  if [[ -z "${usage}" ]]; then
    cpu="N/A"
    mem="N/A"
  else
    cpu="$(echo "$usage" | awk -F'\t' '{print $1}')"
    mem="$(echo "$usage" | awk -F'\t' '{print $2}')"
  fi

  echo -e "${ns}\t${cpu}\t${mem}\t${created}\t${requester}" >> "$OUT_FILE"
done

echo "OK -> generado: $OUT_FILE"


        ***********


#!/usr/bin/env bash
set -euo pipefail

PATTERN='col-c-dev|dv'
OUT_FILE="reporte_limits_namespaces.txt"

# Lista namespaces filtrados
mapfile -t NAMESPACES < <(oc get ns -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | grep -E "$PATTERN" || true)

# Header
{
  echo -e "NAMESPACE\tCPU_LIMIT(m)\tMEM_LIMIT(Mi)\tCREATED_AT\tREQUESTER"
  echo -e "---------\t-----------\t------------\t----------\t---------"
} > "$OUT_FILE"

for ns in "${NAMESPACES[@]}"; do
  created="$(oc get ns "$ns" -o jsonpath='{.metadata.creationTimestamp}' 2>/dev/null || echo 'N/A')"
  requester="$(oc get project "$ns" -o jsonpath='{.metadata.annotations.openshift\.io/requester}' 2>/dev/null || echo 'N/A')"

  rq_json="$(oc get resourcequota -n "$ns" -o json 2>/dev/null || echo '{}')"

  # Suma limits.cpu (m) y limits.memory (Mi) en spec.hard de todas las quotas del ns
  cpu_m="$(echo "$rq_json" | jq -r '
    def cpu_to_m:
      if . == null then 0
      elif (type=="number") then (. * 1000)
      else
        tostring
        | if test("m$") then (sub("m$";"")|tonumber)
          else (tonumber * 1000)
          end
      end;

    [ .items[]?.spec.hard["limits.cpu"]? ] | map(cpu_to_m) | add // empty
  ' 2>/dev/null || true)"

  mem_mi="$(echo "$rq_json" | jq -r '
    def mem_to_mi:
      if . == null then 0
      else
        tostring
        | if test("Ki$") then (sub("Ki$";"")|tonumber/1024)
          elif test("Mi$") then (sub("Mi$";"")|tonumber)
          elif test("Gi$") then (sub("Gi$";"")|tonumber*1024)
          elif test("Ti$") then (sub("Ti$";"")|tonumber*1024*1024)
          else (tonumber) # si viene sin unidad, asumimos Mi
          end
      end;

    [ .items[]?.spec.hard["limits.memory"]? ] | map(mem_to_mi) | add // empty
  ' 2>/dev/null || true)"

  # Si no hay esos campos en quotas
  [[ -z "${cpu_m:-}" ]] && cpu_m="N/A"
  [[ -z "${mem_mi:-}" ]] && mem_mi="N/A"

  # Formato final (si existen)
  [[ "$cpu_m" != "N/A" ]] && cpu_m="$(printf "%.0f" "$cpu_m")"
  [[ "$mem_mi" != "N/A" ]] && mem_mi="$(printf "%.0f" "$mem_mi")"

  echo -e "${ns}\t${cpu_m}\t${mem_mi}\t${created}\t${requester}" >> "$OUT_FILE"
done

echo "OK -> generado: $OUT_FILE"
  
