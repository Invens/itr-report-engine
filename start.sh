#!/bin/sh
set -eu

ENV_FILE="${ENV_FILE:-.env}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required but was not found." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required but was not found." >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  cp .env.example "$ENV_FILE"
fi

read_env() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}

write_env() {
  key="$1"
  value="$2"
  temp_file="${ENV_FILE}.tmp"

  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    $0 ~ "^" key "=" {
      print key "=" value
      found = 1
      next
    }
    { print }
    END {
      if (!found) print key "=" value
    }
  ' "$ENV_FILE" > "$temp_file"

  mv "$temp_file" "$ENV_FILE"
}

postgres_password="$(read_env POSTGRES_PASSWORD)"
if [ -z "$postgres_password" ]; then
  if command -v openssl >/dev/null 2>&1; then
    postgres_password="$(openssl rand -hex 24)"
  else
    postgres_password="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
  fi

  write_env POSTGRES_PASSWORD "$postgres_password"
  echo "Generated a persistent PostgreSQL password in $ENV_FILE."
fi

if [ -z "${DEEPSEEK_API_KEY:-}" ] && [ -z "$(read_env DEEPSEEK_API_KEY)" ]; then
  echo "Set DEEPSEEK_API_KEY in your shell or $ENV_FILE." >&2
  echo "Example: DEEPSEEK_API_KEY=your-key sh ./start.sh" >&2
  exit 1
fi

docker compose --env-file "$ENV_FILE" up --build -d

app_port="$(read_env APP_PORT)"
app_port="${app_port:-3000}"

echo ""
echo "ITR Report Engine is starting."
echo "Dashboard: http://localhost:$app_port"
echo "Status: docker compose --env-file $ENV_FILE ps"
echo "Logs:   docker compose --env-file $ENV_FILE logs -f web api"
