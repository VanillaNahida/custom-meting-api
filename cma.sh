#!/bin/bash

# Custom Meting API 管理脚本
# 支持 start/stop/status/log 等操作

set -e

# 配置
APP_NAME="custom-meting-api"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ECOSYSTEM_FILE="$SCRIPT_DIR/ecosystem.config.js"
NODE_BIN="node"
PM2_BIN="pm2"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# 检查PM2是否安装
check_pm2() {
    if ! command -v $PM2_BIN &> /dev/null; then
        log_error "PM2 未安装，请先运行: npm install pm2 -g"
        exit 1
    fi
}

# 创建必要的目录
setup_directories() {
    log_info "检查目录结构..."
    
    # 创建logs目录
    if [ ! -d "$SCRIPT_DIR/logs" ]; then
        mkdir -p "$SCRIPT_DIR/logs"
        log_success "已创建 logs 目录"
    else
        log_info "logs 目录已存在"
    fi
    
    # 创建playlist目录
    if [ ! -d "$SCRIPT_DIR/playlist" ]; then
        mkdir -p "$SCRIPT_DIR/playlist"
        mkdir -p "$SCRIPT_DIR/playlist/daytime"
        mkdir -p "$SCRIPT_DIR/playlist/night"
        log_success "已创建 playlist 目录结构"
    else
        log_info "playlist 目录已存在"
    fi
    
    # 创建assets目录
    if [ ! -d "$SCRIPT_DIR/assets" ]; then
        mkdir -p "$SCRIPT_DIR/assets"
        log_success "已创建 assets 目录"
    else
        log_info "assets 目录已存在"
    fi
}

# 获取应用状态
get_app_status() {
    # 使用pm2 jlist获取JSON格式的进程列表，更容易解析
    local json=$($PM2_BIN jlist)
    
    # 使用grep和awk从JSON中提取状态
    echo "$json" | grep -o "\"name\":\"${APP_NAME}\"[^{]*\"status\":\"[^\"]*\"" | grep -o "\"status\":\"[^\"]*\"" | cut -d'"' -f4
}

# 清理旧的实例
cleanup_old_instances() {
    log_info "正在清理旧的实例..."
    
    # 删除已存在的同名应用（如果存在）
    if $PM2_BIN list | grep -q "${APP_NAME}"; then
        log_warn "发现旧的实例，正在删除..."
        $PM2_BIN delete $APP_NAME 2>/dev/null || true
    fi
    
    # 检查端口是否被占用
    PORT=$(grep -o 'PORT: [0-9]*' $ECOSYSTEM_FILE | grep -o '[0-9]*' | head -1)
    if netstat -tuln 2>/dev/null | grep -q ":${PORT} " || ss -tuln 2>/dev/null | grep -q ":${PORT} "; then
        log_warn "端口 ${PORT} 已被占用，正在查找占用进程..."
        if command -v lsof &> /dev/null; then
            lsof -i :${PORT} || true
        elif command -v fuser &> /dev/null; then
            fuser -v ${PORT}/tcp || true
        fi
        log_warn "如果需要停止占用进程，请手动处理"
    fi
}

# 启动服务
start_service() {
    check_pm2
    setup_directories
    cleanup_old_instances
    
    log_info "正在启动 $APP_NAME 服务..."
    
    # 使用PM2启动服务
    $PM2_BIN start $ECOSYSTEM_FILE --env production
    
    # 等待服务启动
    sleep 2
    
    # 使用pm2 describe获取状态，更可靠
    local status=$($PM2_BIN describe $APP_NAME 2>/dev/null | grep "status" | head -1 | awk '{print $4}')
    
    if [ "$status" = "online" ]; then
        # 保存PM2进程列表
        $PM2_BIN save
        
        log_success "服务启动成功！"
        echo ""
        echo "======================================"
        echo "  $APP_NAME 服务已启动"
        echo "======================================"
        echo ""
        echo "查看状态: $0 status"
        echo "查看日志: $0 log"
        echo "进入监控: $0 monit"
        echo ""
    else
        log_error "服务启动失败，状态: $status"
        log_info "请查看日志: $0 log --err"
        exit 1
    fi
}

# 停止服务
stop_service() {
    check_pm2
    
    log_info "正在停止 $APP_NAME 服务..."
    
    $PM2_BIN stop $APP_NAME 2>/dev/null || true
    $PM2_BIN delete $APP_NAME 2>/dev/null || true
    $PM2_BIN save
    
    log_success "服务已停止"
}

# 重启服务
restart_service() {
    check_pm2
    
    log_info "正在重启 $APP_NAME 服务..."
    
    cleanup_old_instances
    $PM2_BIN start $ECOSYSTEM_FILE --env production
    
    sleep 2
    
    # 使用pm2 describe获取状态
    local status=$($PM2_BIN describe $APP_NAME 2>/dev/null | grep "status" | head -1 | awk '{print $4}')
    
    if [ "$status" = "online" ]; then
        $PM2_BIN save
        log_success "服务重启成功"
    else
        log_error "服务重启失败，状态: $status"
        exit 1
    fi
}

# 查看状态
show_status() {
    check_pm2
    
    echo ""
    echo "======================================"
    echo "  $APP_NAME 服务状态"
    echo "======================================"
    echo ""
    
    $PM2_BIN status
}

# 查看日志
show_log() {
    check_pm2
    
    local follow=""
    local lines="100"
    
    # 解析参数
    while [[ $# -gt 0 ]]; do
        case $1 in
            -f|--follow)
                follow="-f"
                shift
                ;;
            -n|--lines)
                lines="$2"
                shift 2
                ;;
            --err)
                $PM2_BIN logs $APP_NAME --err --lines $lines
                return
                ;;
            --out)
                $PM2_BIN logs $APP_NAME --out --lines $lines
                return
                ;;
            *)
                shift
                ;;
        esac
    done
    
    if [ -n "$follow" ]; then
        $PM2_BIN logs $APP_NAME -f
    else
        $PM2_BIN logs $APP_NAME --lines $lines
    fi
}

# 监控面板
show_monit() {
    check_pm2
    $PM2_BIN monit
}

# 清理日志
clean_log() {
    check_pm2
    
    log_info "正在清理日志..."
    $PM2_BIN flush
    log_success "日志已清理"
}

# 显示帮助
show_help() {
    echo ""
    echo "======================================"
    echo "  $APP_NAME 管理脚本"
    echo "======================================"
    echo ""
    echo "用法: $0 [命令]"
    echo ""
    echo "命令:"
    echo "  start          启动服务"
    echo "  stop           停止服务"
    echo "  restart        重启服务"
    echo "  status         查看服务状态"
    echo "  log [选项]     查看日志"
    echo "  monit          进入监控面板"
    echo "  clean          清理日志"
    echo "  help           显示帮助信息"
    echo ""
    echo "日志选项:"
    echo "  -f, --follow   实时跟踪日志"
    echo "  -n, --lines N  显示最近N行日志"
    echo "  --err          只显示错误日志"
    echo "  --out          只显示标准输出"
    echo ""
    echo "示例:"
    echo "  $0 start"
    echo "  $0 log"
    echo "  $0 log -f"
    echo "  $0 log --err"
    echo "  $0 status"
    echo ""
}

# 主函数
main() {
    local command="${1:-}"
    
    case "$command" in
        start)
            start_service
            ;;
        stop)
            stop_service
            ;;
        restart)
            restart_service
            ;;
        status)
            show_status
            ;;
        log)
            shift
            show_log "$@"
            ;;
        monit)
            show_monit
            ;;
        clean)
            clean_log
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            log_error "未知命令: $command"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

# 执行主函数
main "$@"
