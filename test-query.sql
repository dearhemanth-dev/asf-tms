SELECT 
  id,
  tenant_id,
  organization_name,
  samsara_api_key IS NOT NULL as has_samsara_key,
  samsara_webhook_url IS NOT NULL as has_webhook_url
FROM public.organizations 
LIMIT 10;