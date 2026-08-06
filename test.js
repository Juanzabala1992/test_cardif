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

**********************************************************************************************
  *************************************************************************************


  #!/usr/bin/env bash

set -euo pipefail

PATTERN='c-prd-|c-prod-'
FORMATO='table'
JSON_FIRST=true

usage() {
  cat <<'EOF'
Uso: ./extract_deployments.sh [-p <patrón>] [-f <formato>]

Opciones:

  -p <patrón>   Patrón para buscar namespaces.
                Default: c-prd-|c-prod-

  -f <formato>  Formato de salida:
                  table
                  csv
                  json
                Default: table

  -h            Mostrar esta ayuda.

Ejemplos:

  ./extract_deployments.sh

  ./extract_deployments.sh \
    -p 'c-prd-|c-prod-' \
    -f table

  ./extract_deployments.sh \
    -p '^bra-c-prd-' \
    -f csv

  ./extract_deployments.sh \
    -f json
EOF
}


# ============================================================
# Leer parámetros
# ============================================================

while getopts ':p:f:h' opt; do
  case "$opt" in

    p)
      PATTERN=$OPTARG
      ;;

    f)
      FORMATO=$OPTARG
      ;;

    h)
      usage
      exit 0
      ;;

    :)
      echo "La opción -$OPTARG requiere un valor." >&2
      usage >&2
      exit 1
      ;;

    \?)
      echo "Opción no válida: -$OPTARG" >&2
      usage >&2
      exit 1
      ;;

  esac
done


# ============================================================
# Validar formato solicitado
# ============================================================

case "$FORMATO" in

  table|csv|json)
    ;;

  *)
    echo "Formato no válido: $FORMATO" >&2
    echo "Los formatos permitidos son: table, csv o json." >&2
    exit 1
    ;;

esac


# ============================================================
# Validar comandos requeridos
# ============================================================

for command in oc jq awk; do

  if ! command -v "$command" >/dev/null 2>&1; then
    echo "No se encontró el comando requerido: $command" >&2
    exit 1
  fi

done


# ============================================================
# Obtener namespaces que coincidan con el patrón
# ============================================================

mapfile -t ns_list < <(
  oc get namespaces \
    -o jsonpath='{.items[*].metadata.name}' |
    tr ' ' '\n' |
    grep -E "$PATTERN" || true
)


if (( ${#ns_list[@]} == 0 )); then

  echo \
    "No se encontraron namespaces que coincidan con el patrón: $PATTERN" \
    >&2

  exit 0

fi


# ============================================================
# Imprimir resultado
# ============================================================

print_result() {

  local ns=$1
  local dep_name=$2
  local cpu_total=$3
  local mem_total=$4

  case "$FORMATO" in

    table)

      printf '%-40s %12s %12s\n' \
        "$dep_name" \
        "$cpu_total" \
        "$mem_total"

      ;;


    csv)

      printf '%s,%s,%s,%s\n' \
        "$ns" \
        "$dep_name" \
        "$cpu_total" \
        "$mem_total"

      ;;


    json)

      # Separar los objetos JSON con coma,
      # evitando dejar una coma al final.
      if [[ "$JSON_FIRST" == true ]]; then
        JSON_FIRST=false
      else
        printf ',\n'
      fi

      if [[ "$cpu_total" == '-' ]]; then
        cpu_total=null
      fi

      if [[ "$mem_total" == '-' ]]; then
        mem_total=null
      fi

      printf \
        '  {"namespace":"%s","name":"%s","cpuCores":%s,"memGiB":%s}' \
        "$ns" \
        "$dep_name" \
        "$cpu_total" \
        "$mem_total"

      ;;

  esac
}


# ============================================================
# Procesar deployments de un namespace
# ============================================================

summarise_deployments() {

  local ns=$1
  local dep_json
  local dep
  local dep_name
  local selector
  local metrics
  local cpu_total
  local mem_total


  # Obtener todos los deployments del namespace.
  dep_json=$(
    oc get deployments \
      -n "$ns" \
      -o json \
      2>/dev/null
  ) || return 0


  # Si el namespace no tiene deployments, continuar.
  if [[ $(jq '.items | length' <<< "$dep_json") -eq 0 ]]; then
    return 0
  fi


  # Imprimir encabezado para la salida tipo tabla.
  if [[ "$FORMATO" == 'table' ]]; then

    printf '\nNAMESPACE: %s\n' "$ns"

    printf '%-40s %12s %12s\n' \
      'NAME' \
      'CPU(cores)' \
      'MEM(GiB)'

    printf '%0.s-' {1..68}
    printf '\n'

  fi


  # Recorrer los deployments.
  while IFS= read -r dep; do

    dep_name=$(
      jq -r '.metadata.name' <<< "$dep"
    )


    # Crear el selector usando los matchLabels del deployment.
    #
    # Ejemplo:
    # app=mi-aplicacion,version=v1
    selector=$(
      jq -r '
        .spec.selector.matchLabels
        | to_entries
        | map("\(.key)=\(.value)")
        | join(",")
      ' <<< "$dep"
    )


    # Si no existe selector, no se pueden encontrar sus pods.
    if [[ -z "$selector" ]]; then

      print_result \
        "$ns" \
        "$dep_name" \
        '-' \
        '-'

      continue

    fi


    # Obtener las métricas de todos los pods que pertenezcan
    # al deployment.
    metrics=$(
      oc adm top pods \
        -n "$ns" \
        -l "$selector" \
        --no-headers \
        2>/dev/null || true
    )


    # Si no hay métricas disponibles.
    if [[ -z "$metrics" ]]; then

      print_result \
        "$ns" \
        "$dep_name" \
        '-' \
        '-'

      continue

    fi


    # Convertir:
    #
    # CPU:
    #   n  -> cores
    #   u  -> cores
    #   m  -> cores
    #
    # Memoria:
    #   Ki -> GiB
    #   Mi -> GiB
    #   Gi -> GiB
    #   Ti -> GiB
    #
    # También suma el consumo de todas las réplicas.
    read -r cpu_total mem_total <<< "$(
      awk '
      {
        # ====================================================
        # CPU: convertir a cores
        # ====================================================

        cpu = $2

        if (cpu ~ /n$/) {

          sub(/n$/, "", cpu)
          cpu = cpu / 1000000000

        } else if (cpu ~ /u$/) {

          sub(/u$/, "", cpu)
          cpu = cpu / 1000000

        } else if (cpu ~ /m$/) {

          sub(/m$/, "", cpu)
          cpu = cpu / 1000

        } else {

          cpu = cpu + 0

        }

        sum_cpu += cpu


        # ====================================================
        # Memoria: convertir a GiB
        # ====================================================

        mem = $3

        if (mem ~ /Ki$/) {

          sub(/Ki$/, "", mem)
          mem = mem / 1048576

        } else if (mem ~ /Mi$/) {

          sub(/Mi$/, "", mem)
          mem = mem / 1024

        } else if (mem ~ /Gi$/) {

          sub(/Gi$/, "", mem)
          mem = mem + 0

        } else if (mem ~ /Ti$/) {

          sub(/Ti$/, "", mem)
          mem = mem * 1024

        } else {

          mem = mem + 0

        }

        sum_mem += mem
        rows++
      }

      END {

        if (rows == 0) {

          print "- -"

        } else {

          printf "%.3f %.3f\n", sum_cpu, sum_mem

        }

      }
      ' <<< "$metrics"
    )"


    print_result \
      "$ns" \
      "$dep_name" \
      "$cpu_total" \
      "$mem_total"

  done < <(
    jq -c '.items[]' <<< "$dep_json"
  )
}


# ============================================================
# Encabezado general
# ============================================================

if [[ "$FORMATO" == 'table' ]]; then

  printf '%0.s=' {1..68}
  printf '\n'

  printf \
    'Buscando deployments en namespaces con patrón: %s\n' \
    "$PATTERN"

  printf '%0.s=' {1..68}
  printf '\n'


elif [[ "$FORMATO" == 'csv' ]]; then

  printf 'namespace,name,cpu_cores,mem_gib\n'


elif [[ "$FORMATO" == 'json' ]]; then

  printf '[\n'

fi


# ============================================================
# Ejecutar la consulta por cada namespace
# ============================================================

for ns in "${ns_list[@]}"; do
  summarise_deployments "$ns"
done


# ============================================================
# Cerrar JSON
# ============================================================

if [[ "$FORMATO" == 'json' ]]; then
  printf '\n]\n'
fi
