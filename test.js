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

  cat > extract_limits_excel.sh <<'EOF'
#!/usr/bin/env bash

set -o pipefail

# ============================================================
# Configuración
# ============================================================

# Incluye ambientes:
#   c-prd-
#   c-prod-
#   c-dev-
#   c-dv-
#   c-uat-
#
# Puedes reemplazarlo enviando otro patrón como primer argumento.
PATTERN="${1:-c-(prd|prod|dev|dv|uat)(-|$)}"

# Segundo argumento: nombre del archivo CSV.
OUTPUT_FILE="${2:-limites_deployments_$(date +%Y%m%d_%H%M%S).csv}"


# ============================================================
# Validaciones
# ============================================================

for cmd in oc jq grep; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "ERROR: No se encontró el comando requerido: $cmd" >&2
        exit 1
    fi
done

if ! oc whoami >/dev/null 2>&1; then
    echo "ERROR: No existe una sesión activa en OpenShift." >&2
    echo "Ejecuta primero el comando oc login." >&2
    exit 1
fi


# ============================================================
# Crear archivo compatible con Excel
# ============================================================

# BOM UTF-8 para que Excel reconozca correctamente caracteres.
# sep=; indica que las columnas están separadas por punto y coma.
printf '\xEF\xBB\xBFsep=;\r\n' > "$OUTPUT_FILE"

# Encabezados del archivo.
printf 'Namespace;Servicio;CPU;Memoria\r\n' >> "$OUTPUT_FILE"

rows=0
namespace_count=0


echo "============================================================"
echo "Generando archivo CSV con límites de recursos"
echo "============================================================"
echo "Patrón utilizado: $PATTERN"
echo "Archivo de salida: $OUTPUT_FILE"
echo
echo "Ambientes incluidos:"
echo "  Producción: c-prd- y c-prod-"
echo "  Desarrollo: c-dev- y c-dv-"
echo "  UAT:        c-uat-"
echo "============================================================"


# ============================================================
# Recorrer namespaces
# ============================================================

while IFS= read -r ns; do

    [[ -z "$ns" ]] && continue

    namespace_count=$((namespace_count + 1))

    echo "Procesando namespace: $ns"

    deployment_json="$(
        oc get deployments \
            -n "$ns" \
            -o json \
            2>/dev/null
    )" || {
        echo "  No fue posible consultar deployments."
        continue
    }


    # ========================================================
    # Procesar deployments del namespace
    # ========================================================

    while IFS='|' read -r servicio cpu memoria; do

        [[ -z "$servicio" ]] && continue

        # Excel en español normalmente usa coma decimal.
        cpu="${cpu/./,}"
        memoria="${memoria/./,}"

        printf '"%s";"%s";%s;%s\r\n' \
            "$ns" \
            "$servicio" \
            "$cpu" \
            "$memoria" \
            >> "$OUTPUT_FILE"

        rows=$((rows + 1))

    done < <(
        jq -r '

            # =================================================
            # Convertir CPU de Kubernetes a cores
            #
            # Ejemplos:
            #   10m  -> 0.010
            #   100m -> 0.100
            #   1    -> 1
            # =================================================

            def cpu_to_cores:

                tostring as $quantity

                |

                if ($quantity | test("n$")) then

                    (
                        ($quantity | sub("n$"; "") | tonumber)
                        / 1000000000
                    )

                elif ($quantity | test("u$")) then

                    (
                        ($quantity | sub("u$"; "") | tonumber)
                        / 1000000
                    )

                elif ($quantity | test("m$")) then

                    (
                        ($quantity | sub("m$"; "") | tonumber)
                        / 1000
                    )

                else

                    ($quantity | tonumber)

                end;


            # =================================================
            # Convertir memoria de Kubernetes a GiB
            #
            # Ejemplos:
            #   10Mi  -> 0.009765625 GiB
            #   512Mi -> 0.5 GiB
            #   1Gi   -> 1 GiB
            # =================================================

            def memory_to_gib:

                tostring as $quantity

                |

                if ($quantity | test("Ki$")) then

                    (
                        ($quantity | sub("Ki$"; "") | tonumber)
                        / 1048576
                    )

                elif ($quantity | test("Mi$")) then

                    (
                        ($quantity | sub("Mi$"; "") | tonumber)
                        / 1024
                    )

                elif ($quantity | test("Gi$")) then

                    (
                        $quantity
                        | sub("Gi$"; "")
                        | tonumber
                    )

                elif ($quantity | test("Ti$")) then

                    (
                        ($quantity | sub("Ti$"; "") | tonumber)
                        * 1024
                    )

                elif ($quantity | test("Pi$")) then

                    (
                        ($quantity | sub("Pi$"; "") | tonumber)
                        * 1048576
                    )

                elif ($quantity | test("[kK]$")) then

                    (
                        (
                            $quantity
                            | sub("[kK]$"; "")
                            | tonumber
                        )
                        * 1000
                        / 1073741824
                    )

                elif ($quantity | test("M$")) then

                    (
                        (
                            $quantity
                            | sub("M$"; "")
                            | tonumber
                        )
                        * 1000000
                        / 1073741824
                    )

                elif ($quantity | test("G$")) then

                    (
                        (
                            $quantity
                            | sub("G$"; "")
                            | tonumber
                        )
                        * 1000000000
                        / 1073741824
                    )

                elif ($quantity | test("T$")) then

                    (
                        (
                            $quantity
                            | sub("T$"; "")
                            | tonumber
                        )
                        * 1000000000000
                        / 1073741824
                    )

                else

                    # Un valor sin unidad se interpreta como bytes.
                    (
                        ($quantity | tonumber)
                        / 1073741824
                    )

                end;


            # Redondear a máximo tres decimales.
            def round3:
                (((. * 1000) | round) / 1000 | tostring);


            # =================================================
            # Procesar cada Deployment
            # =================================================

            .items[]

            |

            .metadata.name as $service

            |

            # Sumar CPU limits de todos los contenedores.
            [
                (.spec.template.spec.containers // [])[]

                |

                (
                    .resources.limits.cpu?
                    // empty
                )

                |

                cpu_to_cores

            ] as $cpus

            |

            # Sumar memoria limits de todos los contenedores.
            [
                (.spec.template.spec.containers // [])[]

                |

                (
                    .resources.limits.memory?
                    // empty
                )

                |

                memory_to_gib

            ] as $memories

            |

            [
                $service,

                (
                    if ($cpus | length) > 0 then
                        ($cpus | add | round3)
                    else
                        ""
                    end
                ),

                (
                    if ($memories | length) > 0 then
                        ($memories | add | round3)
                    else
                        ""
                    end
                )
            ]

            |

            join("|")

        ' <<< "$deployment_json"
    )

done < <(
    oc get namespaces \
        -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' \
        2>/dev/null |
    grep -E "$PATTERN" || true
)


# ============================================================
# Resultado
# ============================================================

echo
echo "============================================================"

if (( namespace_count == 0 )); then
    echo "No se encontraron namespaces con el patrón:"
    echo "$PATTERN"
else
    echo "Proceso finalizado correctamente."
    echo "Namespaces procesados: $namespace_count"
    echo "Servicios registrados: $rows"
    echo "Archivo creado: $OUTPUT_FILE"
fi

echo "============================================================"




***********************************************************************

oc get events -A --sort-by=.lastTimestamp | grep -Ei 'NotReady|Ready|Evict|Killing|Reboot|worker1'
EOF
