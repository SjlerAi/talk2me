#!/usr/bin/env bash
set -Eeuo pipefail

: "${SSH_HOST:?SSH_HOST is required}"
: "${SSH_PORT:?SSH_PORT is required}"
: "${SSH_USER:?SSH_USER is required}"
: "${ELITEHOST_SSH_PRIVATE_KEY:?ELITEHOST_SSH_PRIVATE_KEY is required}"
: "${ELITEHOST_SSH_KEY_PASSPHRASE:?ELITEHOST_SSH_KEY_PASSPHRASE is required}"

ssh_dir="${RUNNER_TEMP:?RUNNER_TEMP is required}/talk2me-ssh"
key_file="$ssh_dir/id_deploy"
known_hosts="$ssh_dir/known_hosts"
mkdir -p "$ssh_dir"
chmod 700 "$ssh_dir"
printf '%s\n' "$ELITEHOST_SSH_PRIVATE_KEY" | tr -d '\r' > "$key_file"
chmod 600 "$key_file"

if ! ssh-keygen -y -P "$ELITEHOST_SSH_KEY_PASSPHRASE" -f "$key_file" >/dev/null; then
  echo "The Elitehost private key or its passphrase was not accepted." >&2
  exit 1
fi

ssh-keygen -p -P "$ELITEHOST_SSH_KEY_PASSPHRASE" -N '' -f "$key_file" >/dev/null

: > "$known_hosts"
for attempt in 1 2 3; do
  if ssh-keyscan -p "$SSH_PORT" -T 15 "$SSH_HOST" >> "$known_hosts" 2>/dev/null && [ -s "$known_hosts" ]; then
    break
  fi
  echo "SSH host-key scan attempt $attempt failed." >&2
  sleep 2
done

if [ ! -s "$known_hosts" ]; then
  echo "Could not obtain the Elitehost SSH host key after three attempts." >&2
  exit 1
fi

chmod 600 "$known_hosts"
{
  echo "GIT_SSH_COMMAND=ssh -i $key_file -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$known_hosts"
  echo "SSH_KEY_FILE=$key_file"
  echo "SSH_KNOWN_HOSTS_FILE=$known_hosts"
} >> "${GITHUB_ENV:?GITHUB_ENV is required}"

cat > "$ssh_dir/config" <<EOF
Host $SSH_HOST
  HostName $SSH_HOST
  Port $SSH_PORT
  User $SSH_USER
  IdentityFile $key_file
  IdentitiesOnly yes
  BatchMode yes
  StrictHostKeyChecking yes
  UserKnownHostsFile $known_hosts
  ConnectTimeout 20
  ServerAliveInterval 15
  ServerAliveCountMax 3
EOF
chmod 600 "$ssh_dir/config"
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
cp "$ssh_dir/config" "$HOME/.ssh/config"
chmod 600 "$HOME/.ssh/config"
echo "SSH configuration and key validation completed."
