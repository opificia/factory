{{- /*
SPDX-FileCopyrightText: The Opificia Authors
SPDX-License-Identifier: CC0-1.0
*/ -}}

{{/* The base name of every object: the release name, with "opificia" unless the release name has it. */}}
{{- define "opificia.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 40 | trimSuffix "-" -}}
{{- else if contains "opificia" .Release.Name -}}
{{- .Release.Name | trunc 40 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-opificia" .Release.Name | trunc 40 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{/* Labels that select the pods of one component. Call with (dict "root" $ "component" "api"). */}}
{{- define "opificia.selectorLabels" -}}
app.kubernetes.io/name: opificia
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/* Every label of a component's objects. Sandboxes carry opificia.role: sandbox; nothing in the chart may. */}}
{{- define "opificia.labels" -}}
{{ include "opificia.selectorLabels" . }}
app.kubernetes.io/part-of: opificia
app.kubernetes.io/version: {{ .root.Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .root.Chart.Name .root.Chart.Version | replace "+" "_" }}
{{- end -}}

{{/* The server image. */}}
{{- define "opificia.image" -}}
{{- $repository := required "image.repository is required: the server image you built from apps/server/Dockerfile" .Values.image.repository -}}
{{- if .Values.image.digest -}}
{{ $repository }}@{{ .Values.image.digest }}
{{- else -}}
{{ $repository }}:{{ required "image.tag or image.digest is required" .Values.image.tag }}
{{- end -}}
{{- end -}}

{{/* The name of the service through which sandboxes reach the worker. */}}
{{- define "opificia.sandboxService" -}}
{{ include "opificia.fullname" . }}-sandbox
{{- end -}}

{{/* The pod security context of the server and the migrations: the node user of the image. */}}
{{- define "opificia.podSecurityContext" -}}
runAsNonRoot: true
runAsUser: 1000
runAsGroup: 1000
fsGroup: 1000
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- define "opificia.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: ["ALL"]
{{- end -}}

{{/* A value from the operator's Secret. Call with (list $ "KEY") or (list $ "KEY" true) for an optional key. */}}
{{- define "opificia.secretEnv" -}}
{{- $root := index . 0 -}}
{{- $key := index . 1 -}}
- name: {{ $key }}
  valueFrom:
    secretKeyRef:
      name: {{ required "existingSecret is required: the Secret with the database URL, the auth secret, and the GitHub and model credentials" $root.Values.existingSecret }}
      key: {{ $key }}
      {{- if gt (len .) 2 }}
      optional: true
      {{- end }}
{{- end -}}

{{/* Variables the chart sets itself, from its own settings or from the Secret. */}}
{{- define "opificia.reservedEnv" -}}
HOME PORT DATABASE_URL VALKEY_URL BETTER_AUTH_URL BETTER_AUTH_SECRET GITHUB_APP_ID GITHUB_APP_CLIENT_ID GITHUB_APP_CLIENT_SECRET GITHUB_APP_PRIVATE_KEY_PATH ANTHROPIC_API_KEY OPIFICIA_ROLE OPIFICIA_API_BIND OPIFICIA_WEB_DIR OPIFICIA_DATA_DIR OPIFICIA_SANDBOX_PORT OPIFICIA_SANDBOX_BIND OPIFICIA_SANDBOX_IMAGE OPIFICIA_SANDBOX_BACKEND OPIFICIA_MAX_SANDBOXES OPIFICIA_SANDBOX_NETWORK OPIFICIA_EGRESS_ALLOW OPIFICIA_ENV_FILE CHECKPOINT_DISABLE BETTER_AUTH_TELEMETRY NODE_ENV
{{- end -}}

{{/* The environment the API and the worker share. */}}
{{- define "opificia.env" -}}
- name: HOME
  value: /tmp
- name: BETTER_AUTH_URL
  value: {{ required "publicUrl is required: the URL people use in the browser, such as https://opificia.example.org" .Values.publicUrl | trimSuffix "/" | quote }}
- name: GITHUB_APP_PRIVATE_KEY_PATH
  value: /etc/opificia/github-app.pem
{{- if .Values.valkey.enabled }}
- name: VALKEY_URL
  value: {{ printf "redis://%s-valkey:6379" (include "opificia.fullname" .) | quote }}
{{- else }}
{{ include "opificia.secretEnv" (list . "VALKEY_URL" true) }}
{{- end }}
{{ include "opificia.secretEnv" (list . "DATABASE_URL") }}
{{ include "opificia.secretEnv" (list . "BETTER_AUTH_SECRET") }}
{{ include "opificia.secretEnv" (list . "GITHUB_APP_ID") }}
{{ include "opificia.secretEnv" (list . "GITHUB_APP_CLIENT_ID") }}
{{ include "opificia.secretEnv" (list . "GITHUB_APP_CLIENT_SECRET") }}
{{ include "opificia.secretEnv" (list . "ANTHROPIC_API_KEY") }}
{{- range $name, $value := .Values.env }}
{{- if or (has $name (include "opificia.reservedEnv" $ | splitList " ")) (hasPrefix "OPIFICIA_KUBERNETES_" $name) }}
{{- fail (printf "env.%s is set by the chart; use the chart's own setting instead (see values.yaml)" $name) }}
{{- end }}
- name: {{ $name }}
  value: {{ $value | toString | quote }}
{{- end }}
{{- end -}}

{{/* The volumes the API and the worker share: the GitHub App's private key, and /tmp. */}}
{{- define "opificia.volumes" -}}
- name: github-app
  secret:
    secretName: {{ .Values.existingSecret }}
    defaultMode: 0440
    items:
      - key: GITHUB_APP_PRIVATE_KEY
        path: github-app.pem
- name: tmp
  emptyDir:
    sizeLimit: 1Gi
{{- end -}}

{{- define "opificia.volumeMounts" -}}
- name: github-app
  mountPath: /etc/opificia
  readOnly: true
- name: tmp
  mountPath: /tmp
{{- end -}}
