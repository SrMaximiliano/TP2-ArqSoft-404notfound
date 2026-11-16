#!/bin/bash
for i in $(seq 1 50); do
  curl -s -o /dev/null -w "%{http_code} %{time_total}\n" \
    -X POST "http://$ARCA_IP:8080/validar" \
    -H "Content-Type: application/json" -d '{"dni":"40405050"}'
done > arca_base_resultados.txt

sort -n -k2 arca_base_resultados.txt
