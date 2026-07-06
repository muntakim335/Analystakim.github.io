# Kubernetes deployment (future-ready)

The API is K8s-ready today: stateless, config via env, `/healthz` (liveness) and
`/readyz` (readiness, pings the DB), graceful SIGTERM drain, horizontal scaling safe
(migrations take a Postgres advisory lock at boot so N replicas don't race).

Minimal shape:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: crm-api }
spec:
  replicas: 2
  selector: { matchLabels: { app: crm-api } }
  template:
    metadata: { labels: { app: crm-api } }
    spec:
      containers:
        - name: api
          image: <your-registry>/nimbuscrm-api:1.0.0
          ports: [{ containerPort: 3001 }]
          envFrom: [{ secretRef: { name: crm-secrets } }]   # DATABASE_URL, JWT_SECRET, REDIS_URL…
          livenessProbe:  { httpGet: { path: /healthz, port: 3001 } }
          readinessProbe: { httpGet: { path: /readyz,  port: 3001 } }
          resources:
            requests: { cpu: 100m, memory: 192Mi }
            limits:   { cpu: "1",  memory: 512Mi }
```

Plus: a `Service` + `Ingress` (or Gateway) with TLS, the web image as a second
Deployment (pure static nginx), managed PostgreSQL (or a Postgres operator like
CloudNativePG) and managed Redis. Move file storage to the S3 adapter
(`src/lib/storage.ts` interface) before scaling past one API replica, or mount a
shared RWX volume for `/data/uploads`.

Sizing guidance and the rollout/rollback runbook live in
`docs/04-operations/deployment.md`.
