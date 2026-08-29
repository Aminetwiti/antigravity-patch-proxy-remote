#!/bin/bash
# scripts/antigravity-maintenance.sh
# Script d'automatisation de la maintenance et du diagnostic sur serveur Linux

# Variables
DOMAINS=("oauth2.googleapis.com" "daily-cloudcode-pa.googleapis.com" "play.googleapis.com")
LOG_DIR="$HOME/.config/Antigravity/logs" # Chemin par défaut pour Linux
DAYS_TO_KEEP=7

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

health_check() {
    echo -e "${CYAN}🔍 Antigravity Health Check (Linux)${NC}"
    echo "=================================================="
    
    # 1. Vérification DNS & Connectivité 443
    echo -e "${YELLOW}[1/3] Résolution DNS & Port 443...${NC}"
    for domain in "${DOMAINS[@]}"; do
        # Test DNS
        ip=$(getent hosts "$domain" | awk '{ print $1 }' | head -n 1)
        if [ -n "$ip" ]; then
            # Test Port 443
            if nc -z -w 3 "$domain" 443 2>/dev/null; then
                echo -e "  ${GREEN}✅ $domain -> Résolution: $ip | TCP 443: OK${NC}"
            else
                echo -e "  ${RED}❌ $domain -> Résolution: $ip | TCP 443: ÉCHEC${NC}"
            fi
        else
            echo -e "  ${RED}❌ $domain -> ÉCHEC Résolution DNS${NC}"
        fi
    done
    
    # 2. Vérification Proxy Local
    BIND_HOST=${AG_BIND_HOST:-127.0.0.1}
    echo -e "\n${YELLOW}[2/3] Vérification du Proxy Local (Port ${AG_PROXY_PORT:-51074})...${NC}"
    if nc -z -w 2 "$BIND_HOST" ${AG_PROXY_PORT:-51074} 2>/dev/null; then
        echo -e "  ${GREEN}✅ Proxy local (Port ${AG_PROXY_PORT:-51074}) actif et à l'écoute.${NC}"
    else
        echo -e "  ${RED}❌ Proxy local (Port ${AG_PROXY_PORT:-51074}) inactif ou inaccessible.${NC}"
    fi
    
    # 3. Espace Disque
    echo -e "\n${YELLOW}[3/3] Espace disque disponible...${NC}"
    free_space=$(df -h / | awk 'NR==2 {print $4}')
    echo -e "  ${GREEN}✅ Espace disponible sur / : $free_space${NC}"
    
    echo "=================================================="
}

cleanup_logs() {
    echo -e "${CYAN}🧹 Nettoyage des anciens logs Antigravity...${NC}"
    if [ ! -d "$LOG_DIR" ]; then
        echo -e "${YELLOW}ℹ️ Dossier logs introuvable à : $LOG_DIR (Rien à nettoyer)${NC}"
        return
    fi
    
    find "$LOG_DIR" -name "*.log" -type f -mtime +$DAYS_TO_KEEP -exec rm -f {} \;
    echo -e "${GREEN}✅ Nettoyage des logs de plus de $DAYS_TO_KEEP jours effectué.${NC}"
}

restart_services() {
    echo -e "${CYAN}🔄 Redémarrage des services et vidage du cache DNS...${NC}"
    
    # Tuer les processus Antigravity
    pkill -f "antigravity" 2>/dev/null
    pkill -f "language-server" 2>/dev/null
    echo -e "  ${GREEN}✅ Processus Antigravity arrêtés.${NC}"
    
    # Flush DNS sous Linux (dépend du gestionnaire)
    if systemctl is-active --quiet systemd-resolved; then
        sudo systemd-resolve --flush-caches 2>/dev/null || sudo resolvectl flush-caches 2>/dev/null
        echo -e "  ${GREEN}✅ Cache systemd-resolved vidé.${NC}"
    elif [ -f /etc/init.d/dns-clean ]; then
        sudo /etc/init.d/dns-clean start >/dev/null
        echo -e "  ${GREEN}✅ Cache DNS (dns-clean) vidé.${NC}"
    else
        echo -e "  ${YELLOW}⚠️ systemd-resolved non actif, flush DNS manuel requis si nécessaire.${NC}"
    fi
}

# Analyse des arguments
case "$1" in
    --health-check)
        health_check
        ;;
    --cleanup)
        cleanup_logs
        ;;
    --restart)
        restart_services
        ;;
    *)
        echo "Usage: $0 {--health-check|--cleanup|--restart}"
        exit 1
        ;;
esac
