# Deploy the ITR Report Engine on Coolify

This repository includes a dedicated production stack at `docker-compose.coolify.yml`. It keeps PostgreSQL, Redis, the migration job, and the Fastify API private. Only the Next.js `web` service is routed through the Coolify proxy.

## 1. Create the resource

1. Open the target Coolify project and environment.
2. Select **Create New Resource**.
3. Connect the private GitHub repository through the Coolify GitHub App or a deploy key.
4. Select `Invens/itr-report-engine`.
5. Choose the **Docker Compose** build pack.
6. Set the compose file location to:

```text
/docker-compose.coolify.yml
```

7. Deploy from `main` after the implementation pull request is merged. For staging, select `agent/production-itr-engine`.

## 2. Environment variables

Coolify will detect the variables referenced by the compose file.

Set this required secret as a runtime variable only:

```text
DEEPSEEK_API_KEY=<new DeepSeek API key>
```

Optional variables:

```text
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
MAX_UPLOAD_MB=25
POSTGRES_DB=itr
POSTGRES_USER=itr
```

Do not expose the DeepSeek key as a build variable. The application only needs it at runtime.

The following Coolify magic variables are generated automatically and should remain managed by Coolify:

```text
SERVICE_PASSWORD_POSTGRES
SERVICE_PASSWORD_REDIS
SERVICE_URL_WEB_3000
```

## 3. Domain

Open the `web` service and assign the production domain to container port `3000`.

Example:

```text
https://itr.example.com:3000
```

The `:3000` portion tells Coolify which internal container port receives traffic. Visitors still use normal HTTPS through the Coolify proxy.

Create the required DNS A/AAAA record before enabling the domain. Coolify will provision HTTPS after DNS resolves to the server.

Do not assign domains or host ports to `api`, `postgres`, `redis`, or `migrate`.

## 4. Persistent data

The compose stack defines three named volumes:

```text
postgres_data
redis_data
document_storage
```

They preserve:

- PostgreSQL records, templates, report history, and audit events
- Redis state
- uploaded ITR PDFs
- generated DOCX reports

Do not delete these volumes during normal redeployments.

## 5. First deployment sequence

Coolify will run the services in this order:

```text
PostgreSQL becomes healthy
        ↓
Prisma migration job completes
        ↓
Redis becomes healthy
        ↓
Fastify API becomes healthy
        ↓
Next.js web service becomes healthy
        ↓
Coolify routes HTTPS traffic
```

The migration container is marked `exclude_from_hc` because it is expected to exit successfully after applying migrations.

## 6. Verification

Confirm these resources after deployment:

```text
postgres   healthy
redis      healthy
migrate    exited (0)
api        healthy
web        healthy
```

Test:

1. Open the production domain.
2. Upload two machine-readable ITR acknowledgement PDFs.
3. Generate a Word report.
4. Open **Reports** and download the stored report.
5. Open **Audit log** and confirm extraction/report events.
6. Open **Templates**, change a harmless placeholder, save it, and confirm a template audit event.

## 7. Updates

After merging changes into the deployed branch, use **Redeploy** in Coolify. The migration service applies only unapplied Prisma migrations. Named volumes remain intact.

## 8. Production checklist

Before public access:

- rotate any API key previously pasted into terminals or chat
- use a restricted staff-only domain or authentication gateway
- configure daily PostgreSQL and document-storage backups
- set an upload-size limit appropriate for the server
- monitor disk usage for uploaded PDFs and generated reports
- retain financial documents only for the period approved by the firm
