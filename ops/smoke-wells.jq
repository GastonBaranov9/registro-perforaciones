# Same domain rules as smoke-wells.ps1 (012/017/019).
def positive_id: type == "number" and . > 0 and . <= 9007199254740991 and floor == .;
type == "array" and all(.[];
  (.id_pozo | positive_id) and has("id_propietario") and
  (if .id_propietario != null then
     (.id_propietario | positive_id) and .propietario_provisional == null
   elif .propietario_provisional != null then
     (.propietario_provisional | type == "string" and length <= 160 and (gsub("^ +| +$"; "") | length > 0))
   else .origen == "historico" end) and
  (.foto_url == null or (.foto_url | type == "string")))
