# Predicciones

## Caso 1 nodo 

### Prueba steps.yaml

Para los exchanges exitosos tenemos en cuenta:
- La latencia de red hasta la nube (169 ms, medida contra `/`).
- La validación en el contenedor de ARCA (351 ms, mediana de requests exitosas medida directamente desde el jumpbox con `perf/results/arca_base/arca_base.sh`, resumen en `perf/results/arca_base/arca_base_resumen.txt`).
- Si ARCA aprueba el DNI, se hacen dos transferencias simuladas de entre 200 y 400 ms cada una (tomamos 300 ms para cada una). Si lo rechaza, no hay transferencias y arVault responde 403.

En los primeros escalones con carga baja, la mediana de los exchanges exitosos debería ser cercana a los 1120 ms (169 + 351 + 600). Los rechazos de ARCA (403) deberían ser de aproximadamente 520 (169 + 351) ms porque no realizan las transferencias. A medida que aumenta la carga, esperamos que el cuello de botella sea el proceso node ya que usa un solo core de los dos de la VM (pm2 modo fork). 

Creemos que, a partir de los escalones de entre 200 y 300 req/s, el core llegará al 100%, ya que la mayor parte del tiempo de cada request es espera (red, ARCA, transferencias) y lo único que se acumula con la carga es el trabajo de CPU del único hilo de node. Si el core se satura, esperamos que suba la latencia de todos los códigos (200, 403 y 503) y que empiecen a aparecer timeouts. No esperamos que ARCA sea el límite en este caso, así que su latencia debería mantenerse cerca de los 351 ms medidos aunque arVault esté saturado.

### Prueba 2 nodos

Con 2 nodos el LB reparte la carga, por lo que cada nodo recibe la mitad y su CPU no debería saturarse hasta 700-800 req/s en total (el doble de lo que soportó con un solo nodo). Sin embargo, ambos nodos consultan el mismo contenedor de ARCA, que tiene 0.5 vCPU y recibe una llamada por cada exchange. Hasta 500 req/s ARCA no mostró degradación, pero creemos que por encima de esa carga se va a saturar antes que los nodos, por lo que el throughput no va a escalar de forma proporcional. Estimamos que el sistema va a sostener alrededor de 500-600 req/s. Si ARCA es el límite, esperamos ver que su latencia deje de estar plana y que aumentan los códigos 503.