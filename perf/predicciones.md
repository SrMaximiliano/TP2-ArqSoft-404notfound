# Predicciones

## Caso 1 nodo 

### Prueba steps.yaml

Para los exchanges exitosos tenemos en cuenta:
- La latencia de red hasta la nube (169 ms, medida contra `/`).
- La validación en el contenedor de ARCA (351 ms, mediana de requests exitosas medida directamente desde el jumpbox con `perf/results/arca_base/arca_base.sh`, resumen en `perf/results/arca_base/arca_base_resumen.txt`).
- Si ARCA aprueba el DNI, se hacen dos transferencias simuladas de entre 200 y 400 ms cada una (tomamos 300 ms para cada una). Si lo rechaza, no hay transferencias y arVault responde 403.

En los primeros escalones con carga baja, la mediana de los exchanges exitosos debería ser cercana a los 1120 ms (169 + 351 + 600). Los rechazos de ARCA (403) deberían ser de aproximadamente 520 (169 + 351) ms porque no realizan las transferencias. A medida que aumenta la carga, esperamos que el cuello de botella sea el proceso node ya que usa un solo core de los dos de la VM (pm2 modo fork). 

Creemos que, a partir de los escalones de entre 200 y 300 req/s, el core llegará al 100%, ya que la mayor parte del tiempo de cada request es espera (red, ARCA, transferencias) y lo único que se acumula con la carga es el trabajo de CPU del único hilo de node. Si el core se satura, esperamos que suba la latencia de todos los códigos (200, 403 y 503) y que empiecen a aparecer timeouts. No esperamos que ARCA sea el límite en este caso, así que su latencia debería mantenerse cerca de los 351 ms medidos aunque arVault esté saturado.

## Caso 2 nodos

Con 2 nodos el LB reparte la carga, por lo que cada nodo recibe la mitad y su CPU no debería saturarse hasta 700-800 req/s en total (el doble de lo que soportó con un solo nodo). Sin embargo, ambos nodos consultan el mismo contenedor de ARCA, que tiene 0.5 vCPU y recibe una llamada por cada exchange. Hasta 500 req/s ARCA no mostró degradación, pero creemos que por encima de esa carga se va a saturar antes que los nodos, por lo que el throughput no va a escalar de forma proporcional. Estimamos que el sistema va a sostener alrededor de 500-600 req/s. Si ARCA es el límite, esperamos ver que su latencia deje de estar plana y que aumentan los códigos 503.

## Táctica reintentos

Tomamos como base la prueba de 2 nodos a ~250 req/s. En esa carga, ARCA aprobó el 49% de las validaciones, rechazó el 26% y falló el 25%. Las latencias medidas desde artillery fueron:

- 200: p50 1150 ms, p95 1330 ms.
- 403: p50 539 ms, p95 686 ms.
- 503: p50 194 ms, p95 215 ms.

La táctica reintenta hasta 2 veces (3 intentos en total, sin backoff ya que los errores no se dan por saturación de ARCA sino que parecen más aleatorios ya que el porcentaje de fallas de ARCA se mantuvo en ~25% con cualquier carga). Es por esto, que un exchange termina en 503 solo si fallan los 3 intentos (25%^3 ≈ 1,6%), por lo que predecimos que la proporción de respuestas debería pasar a ~64% de 200, ~34% de 403 y ~1,6% de 503.

Por otro lado, esperamos que la latencia cambie poco ya que analizando las métricas reportadas por Artillery, observamos que los errores de ARCA son rápidos: de los 194 ms del 503, ~169 ms son la latencia de red hasta la nube, así que cada intento fallido cuesta ~25 ms. Además, el reintento que va del nodo a ARCA, va por adentro de la red interna, así que no se vuelve a pagar esa latencia. Como el ~75% de los exchanges sale en el primer intento, la mediana de cada status code creemos que no va a aumentar tanto y el cambio donde más se va a notar es en el p95, porque la cola ahora incluye a los que reintentaron. Estos son los valores que predecimos en 2 nodos a ~250 req/s:

- 200: p50 1150 ms, p95 1400 ms.
- 403: p50 540 ms, p95 720 ms.
- 503: p50 230 ms, p95 290 ms. -> Este es el que creemos que más va a aumentar ya que acumula las 3 requests fallidas.

Como el límite que observamos fue el CPU de los nodos, esperamos que el sistema se sature un poco antes, aproximadamente alrededor de 300 req/s, en lugar de las ~450 req/s medidas sin reintentos ya que cada exchange hace en promedio ~1,31 llamadas a ARCA y más exchanges llegan a las transferencias (~64% contra ~49%)