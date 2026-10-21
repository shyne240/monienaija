# API Version Guide

## Current version

The current public application prefix is `/api/v1`. M8 exposes the active version through:

```text
GET /api/v1/internal/version
```

Responses include:

- `current`
- `supported`
- `deprecated`
- `header`

Every response includes `X-API-Version: v1`.

## Compatibility policy

- Existing `/api/v1` routes remain backward-compatible.
- Additive response fields are preferred over breaking changes.
- Deprecation must be listed in the version metadata before removal.
- A future incompatible contract requires a new version prefix and an ADR.
- Internal endpoints follow the same version prefix but are not customer or partner contracts.
