import { randomUUID } from "node:crypto";
export async function audit(
  db,
  req,
  action,
  entityType = null,
  entityId = null,
  metadata = {},
) {
  await db.query(
    "INSERT INTO audit_logs(id,user_id,action,entity_type,entity_id,ip_address,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      randomUUID(),
      req?.user?.id || null,
      action,
      entityType,
      entityId,
      req?.ip || null,
      JSON.stringify(metadata),
    ],
  );
}
