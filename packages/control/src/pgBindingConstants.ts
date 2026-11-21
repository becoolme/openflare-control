/**
 * PG binding resource/credential namespaces — server-minted prefixes
 * shared by the deploy adapter, compute.desired and render-inputs, so the
 * three never disagree on a namespace.
 */
/** `vrtpg:<databaseTenantId>` — binding `resourceId` namespace. */
export const VRT_PG_RESOURCE_PREFIX = 'vrtpg:'
/** `vrtpgcred:<databaseTenantId>` — versionless render-inputs key. */
export const VRT_PG_CREDENTIAL_PREFIX = 'vrtpgcred:'
