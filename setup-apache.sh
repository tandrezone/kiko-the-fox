#!/usr/bin/env bash
#
# setup-apache.sh — publish this checkout at snowflakeless.xyz on Apache.
#
#   git clone <repo> && cd <repo> && sudo ./setup-apache.sh
#
# What it does, in order:
#   1. works out whether this is a Debian- or RHEL-style Apache
#   2. checks PHP is present and wired into Apache
#   3. writes a vhost for snowflakeless.xyz  -- and REFUSES to touch one
#      that already exists, so running it twice is harmless
#   4. config-tests, then reloads Apache (rolling back if the test fails)
#   5. makes data/ writable by the web server so the score board works
#   6. curls the site through the vhost and checks the real page came back
#   7. requests a Let's Encrypt certificate
#
# Re-running it is safe: every step is either idempotent or skipped.
#
if [ -z "${BASH_VERSION:-}" ]; then
    exec bash "$0" "$@"
fi

set -Eeuo pipefail

# ---------------------------------------------------------------- settings --
DOMAIN="snowflakeless.xyz"
ALIAS="www.${DOMAIN}"
DOCROOT=""                       # defaults to the directory this script is in
EMAIL="${CERTBOT_EMAIL:-}"
EXPECT="<title>Kiko the Fox</title>"   # a string the real home page must contain
DO_TLS=1
FORCE=0
DRY_RUN=0

usage() {
    cat <<USAGE
Usage: sudo ./setup-apache.sh [options]

  --domain NAME     serve this name instead of ${DOMAIN}
  --docroot PATH    serve this directory instead of the script's own
  --email ADDR      email for the Let's Encrypt account (or set CERTBOT_EMAIL)
  --expect STRING   string the home page must contain (default: the page title)
  --no-tls          skip certbot; set up plain HTTP only
  --force           replace an existing vhost for this domain
  --dry-run         print what would happen, change nothing
  -h, --help        this message
USAGE
}

while [ $# -gt 0 ]; do
    case "$1" in
        --domain)  DOMAIN="$2"; ALIAS="www.$2"; shift 2 ;;
        --docroot) DOCROOT="$2"; shift 2 ;;
        --email)   EMAIL="$2"; shift 2 ;;
        --expect)  EXPECT="$2"; shift 2 ;;
        --no-tls)  DO_TLS=0; shift ;;
        --force)   FORCE=1; shift ;;
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
done

# ----------------------------------------------------------------- output ---
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'
    C_DIM=$'\033[2m';  C_B=$'\033[1m';    C_0=$'\033[0m'
else
    C_OK=""; C_WARN=""; C_ERR=""; C_DIM=""; C_B=""; C_0=""
fi

step() { printf '\n%s==>%s %s%s%s\n' "$C_B" "$C_0" "$C_B" "$*" "$C_0"; }
ok()   { printf '    %sok%s    %s\n'   "$C_OK"   "$C_0" "$*"; }
info() { printf '    %s--%s    %s\n'   "$C_DIM"  "$C_0" "$*"; }
warn() { printf '    %swarn%s  %s\n'   "$C_WARN" "$C_0" "$*" >&2; }
die()  { printf '\n%serror%s  %s\n\n'  "$C_ERR"  "$C_0" "$*" >&2; exit 1; }

run() {
    if [ "$DRY_RUN" -eq 1 ]; then
        printf '    %sdry%s   %s\n' "$C_DIM" "$C_0" "$*"
    else
        "$@"
    fi
}

# Reload however this box actually manages services. systemd on a normal
# server, sysvinit or plain apachectl in a container or an older host.
apache_apply() {
    if command -v systemctl >/dev/null 2>&1 \
       && systemctl list-units --type=service >/dev/null 2>&1; then
        if systemctl is-active --quiet "$SVC"; then
            systemctl reload "$SVC" && return 0
        fi
        systemctl restart "$SVC" && return 0
    fi
    service "$SVC" reload  >/dev/null 2>&1 && return 0
    service "$SVC" restart >/dev/null 2>&1 && return 0
    "$CTL" -k graceful     >/dev/null 2>&1 && return 0
    "$CTL" -k start        >/dev/null 2>&1 && return 0
    return 1
}

# ------------------------------------------------------------------- root ---
[ "$(id -u)" -eq 0 ] || die "run this with sudo: sudo ./setup-apache.sh"

# ---------------------------------------------------------------- docroot ---
step "Locating the site"

if [ -z "$DOCROOT" ]; then
    DOCROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
fi
DOCROOT="${DOCROOT%/}"

[ -d "$DOCROOT" ]            || die "no such directory: $DOCROOT"
[ -f "$DOCROOT/index.php" ]  || die "$DOCROOT has no index.php -- is this the project root?"
info "document root: $DOCROOT"

# ----------------------------------------------------------------- apache ---
step "Detecting Apache"

if   [ -d /etc/apache2 ]; then
    FAMILY="debian"
    SVC="apache2"
    AVAIL_DIR="/etc/apache2/sites-available"
    CONF="${AVAIL_DIR}/${DOMAIN}.conf"
    LOG_DIR="/var/log/apache2"
    CONF_DIRS="/etc/apache2"
    CTL="$(command -v apache2ctl || command -v apachectl || true)"
elif [ -d /etc/httpd ]; then
    FAMILY="rhel"
    SVC="httpd"
    AVAIL_DIR="/etc/httpd/conf.d"
    CONF="${AVAIL_DIR}/${DOMAIN}.conf"
    LOG_DIR="/var/log/httpd"
    CONF_DIRS="/etc/httpd"
    CTL="$(command -v apachectl || command -v httpd || true)"
else
    die "neither /etc/apache2 nor /etc/httpd exists -- install Apache first"
fi

[ -n "$CTL" ] || die "found $FAMILY layout but no apachectl/httpd binary on PATH"
info "$FAMILY layout, service '$SVC', control '$CTL'"

# The user Apache actually runs as, for the permission work further down.
if   id -u www-data >/dev/null 2>&1; then WEB_USER="www-data"
elif id -u apache   >/dev/null 2>&1; then WEB_USER="apache"
elif id -u http     >/dev/null 2>&1; then WEB_USER="http"
else WEB_USER=""; warn "could not work out which user Apache runs as"
fi
[ -n "$WEB_USER" ] && info "web server user: $WEB_USER"

# -------------------------------------------------------------------- php ---
step "Checking PHP"

command -v php >/dev/null 2>&1 || warn "no php CLI on PATH (not fatal, but odd)"
command -v php >/dev/null 2>&1 && info "php cli: $(php -r 'echo PHP_VERSION;' 2>/dev/null || echo unknown)"

PHP_HANDLER=""      # the SetHandler line to drop into the vhost, if any
PHP_MODE=""

# php-fpm over a unix socket is the common modern setup
FPM_SOCK="$(ls -1 /run/php/php*-fpm.sock /run/php-fpm/*.sock /var/run/php/php*-fpm.sock 2>/dev/null \
            | sort -V | tail -n 1 || true)"

if [ -n "$FPM_SOCK" ] && [ -S "$FPM_SOCK" ]; then
    PHP_MODE="php-fpm (socket)"
    PHP_HANDLER="proxy:unix:${FPM_SOCK}|fcgi://localhost/"
elif (command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q '127.0.0.1:9000') \
  || (command -v netstat >/dev/null 2>&1 && netstat -ltn 2>/dev/null | grep -q '127.0.0.1:9000'); then
    PHP_MODE="php-fpm (tcp 9000)"
    PHP_HANDLER="proxy:fcgi://127.0.0.1:9000"
elif "$CTL" -M 2>/dev/null | grep -qi 'php[0-9_]*_module'; then
    PHP_MODE="mod_php"
else
    die "PHP is not wired into Apache.
       Debian/Ubuntu:  apt install php-fpm libapache2-mod-fcgid   (or libapache2-mod-php)
       RHEL/Rocky:     dnf install php php-fpm && systemctl enable --now php-fpm"
fi
info "php runtime: $PHP_MODE"

# Modules the vhost relies on. a2enmod is a no-op when already enabled.
if [ "$FAMILY" = "debian" ]; then
    MODS="rewrite headers"
    [ -n "$PHP_HANDLER" ] && MODS="$MODS proxy proxy_fcgi setenvif"
    for m in $MODS; do
        if "$CTL" -M 2>/dev/null | grep -q "^ *${m}_module"; then
            info "module $m already enabled"
        else
            run a2enmod -q "$m"
            [ "$DRY_RUN" -eq 0 ] && ok "enabled module $m" || true
        fi
    done
fi

# ------------------------------------------------- is the vhost there already
step "Checking for an existing vhost"

EXISTING=""
if [ -f "$CONF" ]; then
    EXISTING="$CONF"
else
    # Somebody may have defined this ServerName in a differently-named file.
    HIT="$(grep -rlE "^[[:space:]]*(ServerName|ServerAlias)[[:space:]]+${DOMAIN}([[:space:]]|$)" \
           "$CONF_DIRS" 2>/dev/null | head -n 1 || true)"
    [ -n "$HIT" ] && EXISTING="$HIT"
fi

WROTE_CONF=0
if [ -n "$EXISTING" ] && [ "$FORCE" -eq 0 ]; then
    warn "$DOMAIN is already configured in $EXISTING"
    info "leaving it untouched -- pass --force to replace it"
    info "skipping ahead to the checks"
else
    if [ -n "$EXISTING" ]; then
        BACKUP="${EXISTING}.bak.$(date +%Y%m%d%H%M%S)"
        run cp -a "$EXISTING" "$BACKUP"
        warn "--force: backed up the old vhost to $BACKUP"
        CONF="$EXISTING"
    fi

    step "Writing $CONF"

    TLS_NOTE="# https is added by certbot; re-run this script or certbot to (re)issue"

    TMP="$(mktemp)"
    {
        echo "# ${DOMAIN} -- written by setup-apache.sh on $(date -Is)"
        echo "# Document root is the git checkout; edit there, not here."
        echo
        echo "<VirtualHost *:80>"
        echo "    ServerName ${DOMAIN}"
        echo "    ServerAlias ${ALIAS}"
        echo
        echo "    DocumentRoot ${DOCROOT}"
        echo "    DirectoryIndex index.php index.html"
        echo
        echo "    <Directory ${DOCROOT}>"
        echo "        Options -Indexes +FollowSymLinks"
        echo "        AllowOverride None"
        echo "        Require all granted"
        echo "    </Directory>"
        echo
        echo "    # the score board is served through api/scores.php, never raw"
        echo "    <Files \"scores.json\">"
        echo "        Require all denied"
        echo "    </Files>"
        echo
        echo "    # nothing under .git should ever be reachable"
        echo "    <DirectoryMatch \"/\\.git\">"
        echo "        Require all denied"
        echo "    </DirectoryMatch>"
        if [ -n "$PHP_HANDLER" ]; then
            echo
            echo "    <FilesMatch \"\\.php\$\">"
            echo "        SetHandler \"${PHP_HANDLER}\""
            echo "    </FilesMatch>"
        fi
        echo
        echo "    ErrorLog ${LOG_DIR}/${DOMAIN}-error.log"
        echo "    CustomLog ${LOG_DIR}/${DOMAIN}-access.log combined"
        echo
        echo "    ${TLS_NOTE}"
        echo "</VirtualHost>"
    } > "$TMP"

    if [ "$DRY_RUN" -eq 1 ]; then
        printf '%s\n' "$C_DIM"; sed 's/^/    | /' "$TMP"; printf '%s' "$C_0"
        rm -f "$TMP"
    else
        install -m 0644 "$TMP" "$CONF"
        rm -f "$TMP"
        WROTE_CONF=1
        ok "vhost written"
    fi

    if [ "$FAMILY" = "debian" ]; then
        run a2ensite -q "$(basename "$CONF" .conf)" && ok "site enabled"
    fi
fi

# ----------------------------------------------------------- config + reload
step "Testing the configuration"

if [ "$DRY_RUN" -eq 1 ]; then
    info "skipped in dry-run"
else
    if ! "$CTL" -t >/tmp/apache-configtest.$$ 2>&1; then
        cat /tmp/apache-configtest.$$ >&2
        rm -f /tmp/apache-configtest.$$
        if [ "$WROTE_CONF" -eq 1 ]; then
            [ "$FAMILY" = "debian" ] && a2dissite -q "$(basename "$CONF" .conf)" || true
            rm -f "$CONF"
            warn "rolled back $CONF so Apache keeps running"
        fi
        die "apache config test failed -- nothing was applied"
    fi
    rm -f /tmp/apache-configtest.$$
    ok "syntax ok"

    step "Reloading Apache"
    if apache_apply; then
        ok "$SVC reloaded"
    else
        die "could not reload $SVC -- try 'systemctl status $SVC' and '$CTL -t'"
    fi
fi

# ------------------------------------------------------------- permissions --
step "Fixing permissions"

# Apache has to be able to walk every directory above the docroot. A checkout
# under /root or a locked-down home is the classic cause of a blank 403.
as_web_user() {   # run a command as the web server user, however we can
    if   command -v runuser >/dev/null 2>&1; then runuser -u "$WEB_USER" -- "$@"
    elif command -v sudo    >/dev/null 2>&1; then sudo -n -u "$WEB_USER" "$@"
    elif command -v su      >/dev/null 2>&1; then su -s /bin/sh -c "$(printf '%q ' "$@")" "$WEB_USER"
    else return 127
    fi
}

if [ -n "$WEB_USER" ] && [ "$DRY_RUN" -eq 0 ]; then
    PROBE=0
    as_web_user test -r "$DOCROOT/index.php" 2>/dev/null || PROBE=$?
    if [ "$PROBE" -eq 0 ]; then
        ok "$WEB_USER can read the document root"
    elif [ "$PROBE" -eq 127 ]; then
        info "no runuser/sudo/su available; skipping the readability probe"
    else
        warn "$WEB_USER cannot read $DOCROOT/index.php"
        warn "every directory on the way down needs +x for others, e.g."
        warn "  chmod o+x $(dirname "$DOCROOT")"
        warn "or move the checkout somewhere like /var/www/${DOMAIN}"
    fi
fi

# data/ holds scores.json, which api/scores.php creates and rewrites.
if [ -d "$DOCROOT/data" ]; then
    if [ -n "$WEB_USER" ]; then
        run chgrp -R "$WEB_USER" "$DOCROOT/data"
        run chmod -R g+rwX "$DOCROOT/data"
        ok "data/ is group-writable by $WEB_USER"
    fi
else
    warn "no data/ directory -- the high-score board will not persist"
fi

# SELinux, where it is switched on, overrides all of the above.
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce 2>/dev/null)" = "Enforcing" ]; then
    info "SELinux is enforcing; labelling the checkout"
    if command -v semanage >/dev/null 2>&1; then
        run semanage fcontext -a -t httpd_sys_content_t "${DOCROOT}(/.*)?" 2>/dev/null || true
        run semanage fcontext -a -t httpd_sys_rw_content_t "${DOCROOT}/data(/.*)?" 2>/dev/null || true
        run restorecon -R "$DOCROOT" >/dev/null 2>&1 || true
        ok "SELinux labels applied"
    else
        warn "install policycoreutils-python-utils, then:"
        warn "  semanage fcontext -a -t httpd_sys_rw_content_t '${DOCROOT}/data(/.*)?' && restorecon -R '$DOCROOT'"
    fi
fi

# --------------------------------------------------------------- verify -----
step "Checking Apache is serving the site"

if [ "$DRY_RUN" -eq 1 ]; then
    info "skipped in dry-run"
else
    command -v curl >/dev/null 2>&1 || die "curl is not installed, cannot verify"

    # Ask for the real hostname but send it to this machine, so the check
    # works before DNS points here -- and follow redirects, so it still
    # works after certbot has turned port 80 into a 301 to HTTPS.
    INSECURE=""
    fetch() {   # fetch <path> <body-file>  -> prints "<code> <final-url>"
        local out
        # --noproxy matters: plenty of servers have http(s)_proxy set for
        # root, and this request must go to *this* machine, not out and back.
        out="$(curl -sS -L --max-time 15 --noproxy '*' $INSECURE \
                    --resolve "${DOMAIN}:80:127.0.0.1" \
                    --resolve "${DOMAIN}:443:127.0.0.1" \
                    -o "$2" -w '%{http_code} %{url_effective}' \
                    "http://${DOMAIN}$1" 2>/dev/null)" || true
        [ -n "$out" ] || out="000 -"
        printf '%s' "$out"
    }

    BODY="$(mktemp)"
    RESULT="$(fetch / "$BODY")"
    CODE="${RESULT%% *}"
    FINAL="${RESULT#* }"

    # Once certbot has added its redirect, port 80 answers 301 and the real
    # check happens over TLS. If that leg fails, retry without certificate
    # verification so we can still tell "cert not trusted" apart from
    # "site is broken" -- and say which it was.
    case "$CODE:$FINAL" in
        200:*) ;;
        *:https://*)
            warn "the HTTPS leg did not verify; retrying without certificate checks"
            INSECURE="-k"
            RESULT="$(fetch / "$BODY")"
            CODE="${RESULT%% *}"
            FINAL="${RESULT#* }"
            [ "$CODE" = "200" ] && warn "the site works, but its certificate is not trusted by curl"
            ;;
    esac

    FAILED=0
    if [ "$CODE" = "200" ]; then
        ok "GET ${FINAL} -> 200"
    else
        warn "GET ${FINAL} -> ${CODE}"
        FAILED=1
    fi

    if grep -qF "$EXPECT" "$BODY"; then
        ok "the body is the site, not a default Apache page"
    else
        warn "the response did not contain: $EXPECT"
        FAILED=1
    fi

    if grep -qF '<?php' "$BODY"; then
        warn "raw PHP came back -- Apache is serving the file instead of running it"
        FAILED=1
    else
        ok "PHP is executing"
    fi

    if [ -f "$DOCROOT/api/levels.php" ]; then
        API="$(mktemp)"
        ACODE="$(fetch "/api/levels.php?id=0" "$API")"
        if [ "${ACODE%% *}" = "200" ] && grep -qF '"chunks"' "$API"; then
            ok "api/levels.php is returning level data"
        else
            warn "api/levels.php did not return level JSON (${ACODE%% *})"
            FAILED=1
        fi
        rm -f "$API"
    fi

    if [ "$FAILED" -ne 0 ]; then
        warn "first 400 bytes of the response:"
        head -c 400 "$BODY" | sed 's/^/      /' >&2 || true
        printf '\n' >&2
        rm -f "$BODY"
        die "the vhost is in place but the site is not being served correctly
       look in ${LOG_DIR}/${DOMAIN}-error.log"
    fi
    rm -f "$BODY"
    SERVED_URL="$FINAL"
fi

# ------------------------------------------------------------------ certbot -
if [ "$DO_TLS" -eq 1 ] && [ "$DRY_RUN" -eq 0 ]; then
    step "HTTPS"

    if [ -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
        ok "a certificate for ${DOMAIN} already exists -- leaving it alone"
        info "renewals are handled by the certbot timer; force one with:"
        info "  certbot renew --force-renewal --cert-name ${DOMAIN}"
    else
        if ! command -v certbot >/dev/null 2>&1; then
            info "installing certbot"
            if   command -v apt-get >/dev/null 2>&1; then
                DEBIAN_FRONTEND=noninteractive apt-get update -qq \
                  && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-apache
            elif command -v dnf >/dev/null 2>&1; then
                dnf install -y -q certbot python3-certbot-apache
            elif command -v yum >/dev/null 2>&1; then
                yum install -y -q certbot python3-certbot-apache
            fi
        fi

        if ! command -v certbot >/dev/null 2>&1; then
            warn "certbot could not be installed; skipping HTTPS"
            warn "once it is available:  certbot --apache -d ${DOMAIN} -d ${ALIAS}"
        else
            # A cert request against a domain that does not point here just
            # burns Let's Encrypt rate limit, so check DNS first.
            PUBLIC_IP="$(curl -sS --max-time 8 https://api.ipify.org 2>/dev/null || true)"
            [ -n "$PUBLIC_IP" ] || PUBLIC_IP="$(curl -sS --max-time 8 https://ifconfig.me/ip 2>/dev/null || true)"
            DOMAIN_IP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)"
            info "this server: ${PUBLIC_IP:-unknown}    ${DOMAIN}: ${DOMAIN_IP:-unresolved}"

            if [ -n "$PUBLIC_IP" ] && [ -n "$DOMAIN_IP" ] && [ "$PUBLIC_IP" != "$DOMAIN_IP" ]; then
                warn "${DOMAIN} does not resolve to this server -- skipping certbot"
                warn "point the A record at ${PUBLIC_IP}, then re-run this script"
            elif [ -z "$DOMAIN_IP" ]; then
                warn "${DOMAIN} does not resolve yet -- skipping certbot"
                warn "add the A record, then re-run this script"
            else
                if [ -z "$EMAIL" ] && [ -t 0 ]; then
                    printf '    email for the Let'\''s Encrypt account (blank to skip HTTPS): '
                    read -r EMAIL
                fi

                CB=(certbot --apache -d "$DOMAIN" -d "$ALIAS"
                    --agree-tos --redirect --non-interactive)
                [ -n "$EMAIL" ] && CB+=(-m "$EMAIL")

                if [ -z "$EMAIL" ]; then
                    warn "no email given; skipping HTTPS"
                    warn "run later with:  sudo ./setup-apache.sh --email you@example.com"
                elif "${CB[@]}"; then
                    ok "certificate issued and the vhost switched to HTTPS"
                else
                    warn "certbot failed -- the site still works over plain HTTP"
                    warn "check that port 80 is open from the internet and try:"
                    warn "  certbot --apache -d ${DOMAIN} -d ${ALIAS}"
                fi
            fi
        fi
    fi
elif [ "$DO_TLS" -eq 0 ]; then
    step "HTTPS"
    info "skipped (--no-tls).  Later:  sudo certbot --apache -d ${DOMAIN} -d ${ALIAS}"
fi

# ------------------------------------------------------------------- done ---
step "Done"

printf '    %s%s%s is served from %s\n' "$C_B" "${SERVED_URL:-http://$DOMAIN/}" "$C_0" "$DOCROOT"
printf '    logs:   %s/%s-error.log\n' "$LOG_DIR" "$DOMAIN"
printf '    config: %s\n' "$CONF"

cat <<UNINSTALL

    ${C_DIM}To undo all of this:${C_0}
UNINSTALL
if [ "$FAMILY" = "debian" ]; then
    printf '      sudo a2dissite %s\n' "$(basename "$CONF" .conf)"
    printf '      sudo rm %s\n' "$CONF"
    printf '      sudo systemctl reload apache2\n'
else
    printf '      sudo rm %s\n' "$CONF"
    printf '      sudo systemctl reload httpd\n'
fi
printf '      sudo certbot delete --cert-name %s   %s# only if a cert was issued%s\n\n' \
       "$DOMAIN" "$C_DIM" "$C_0"
