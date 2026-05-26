-- ============================================================
-- TimescaleDB Schema for Alpaca Data Proxy
-- 数据库优先架构 - 本地数据库存储所有历史数据
-- ============================================================

-- 启用 TimescaleDB 扩展
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ============================================================
-- 1. 股票历史 Bars 表
-- ============================================================
CREATE TABLE IF NOT EXISTS bars (
    symbol          TEXT NOT NULL,
    timeframe       TEXT NOT NULL,        -- '1Min', '5Min', '15Min', '1Hour', '1Day'
    ts              TIMESTAMPTZ NOT NULL,
    open            DOUBLE PRECISION,
    high            DOUBLE PRECISION,
    low             DOUBLE PRECISION,
    close           DOUBLE PRECISION,
    volume          BIGINT,
    vwap            DOUBLE PRECISION,
    trade_count     INT,
    -- 元数据
    feed            TEXT DEFAULT 'sip',   -- 'sip', 'iex'
    source          TEXT DEFAULT 'alpaca', -- 'alpaca', 'thetadata', 'backfill'
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    -- 复合主键
    PRIMARY KEY (symbol, timeframe, ts)
);

-- 转换为 hypertable (按时间分区)
SELECT create_hypertable('bars', 'ts', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_bars_symbol_timeframe_ts ON bars (symbol, timeframe, ts DESC);
CREATE INDEX IF NOT EXISTS idx_bars_symbol_ts ON bars (symbol, ts DESC);

-- 压缩策略：7天前的数据自动压缩 (节省90%+空间)
ALTER TABLE bars SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'symbol,timeframe',
    timescaledb.compress_orderby = 'ts DESC'
);

-- 7天前的 chunks 自动压缩
SELECT add_compression_policy('bars', INTERVAL '7 days', if_not_exists => TRUE);

-- ============================================================
-- 2. 期权历史 Bars 表
-- ============================================================
CREATE TABLE IF NOT EXISTS options_bars (
    symbol          TEXT NOT NULL,        -- OCC 格式: AAPL240119C00190000
    root_symbol     TEXT NOT NULL,        -- 标的股票: AAPL
    expiration_date DATE,
    strike_price    DOUBLE PRECISION,
    option_type     TEXT,                 -- 'call', 'put'
    timeframe       TEXT NOT NULL,
    ts              TIMESTAMPTZ NOT NULL,
    open            DOUBLE PRECISION,
    high            DOUBLE PRECISION,
    low             DOUBLE PRECISION,
    close           DOUBLE PRECISION,
    volume          BIGINT,
    vwap            DOUBLE PRECISION,
    trade_count     INT,
    open_interest   BIGINT,
    feed            TEXT DEFAULT 'opra',
    source          TEXT DEFAULT 'thetadata',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (symbol, timeframe, ts)
);

SELECT create_hypertable('options_bars', 'ts', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_options_bars_root_ts ON options_bars (root_symbol, timeframe, ts DESC);
CREATE INDEX IF NOT EXISTS idx_options_bars_expiry ON options_bars (root_symbol, expiration_date, option_type);

ALTER TABLE options_bars SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'symbol,timeframe',
    timescaledb.compress_orderby = 'ts DESC'
);
SELECT add_compression_policy('options_bars', INTERVAL '7 days', if_not_exists => TRUE);

-- ============================================================
-- 2.5 期权链合约表 (option chain 元数据)
-- ============================================================
CREATE TABLE IF NOT EXISTS option_contracts (
    symbol          TEXT PRIMARY KEY,       -- OCC 格式: AAPL240119C00190000
    root_symbol     TEXT NOT NULL,          -- 标的股票: AAPL
    expiration_date DATE NOT NULL,
    strike_price    DOUBLE PRECISION NOT NULL,
    option_type     TEXT NOT NULL,          -- 'call', 'put'
    -- 元数据
    source          TEXT DEFAULT 'thetadata',
    discovered_at   TIMESTAMPTZ DEFAULT NOW(), -- 首次发现时间
    last_scanned_at TIMESTAMPTZ DEFAULT NOW(), -- 上次扫描时间
    active          BOOLEAN DEFAULT TRUE,   -- 是否还在交易
    UNIQUE (root_symbol, expiration_date, strike_price, option_type)
);

CREATE INDEX IF NOT EXISTS idx_option_contracts_root ON option_contracts (root_symbol);
CREATE INDEX IF NOT EXISTS idx_option_contracts_expiry ON option_contracts (root_symbol, expiration_date);
CREATE INDEX IF NOT EXISTS idx_option_contracts_active ON option_contracts (active) WHERE active = TRUE;

-- ============================================================
-- 3. 最新报价快照表 (实时更新)
-- ============================================================
CREATE TABLE IF NOT EXISTS latest_quotes (
    symbol          TEXT PRIMARY KEY,
    bid_price       DOUBLE PRECISION,
    bid_size        INT,
    ask_price       DOUBLE PRECISION,
    ask_size        INT,
    last_price      DOUBLE PRECISION,
    last_size       INT,
    volume          BIGINT,
    timestamp       TIMESTAMPTZ,
    source          TEXT DEFAULT 'alpaca_ws',
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_latest_quotes_updated ON latest_quotes (updated_at DESC);

-- ============================================================
-- 4. 期权最新报价快照表
-- ============================================================
CREATE TABLE IF NOT EXISTS latest_options_quotes (
    symbol          TEXT PRIMARY KEY,
    root_symbol     TEXT NOT NULL,
    bid_price       DOUBLE PRECISION,
    bid_size        INT,
    ask_price       DOUBLE PRECISION,
    ask_size        INT,
    last_price      DOUBLE PRECISION,
    last_size       INT,
    volume          BIGINT,
    open_interest   BIGINT,
    implied_vol     DOUBLE PRECISION,
    delta           DOUBLE PRECISION,
    gamma           DOUBLE PRECISION,
    theta           DOUBLE PRECISION,
    vega            DOUBLE PRECISION,
    timestamp       TIMESTAMPTZ,
    source          TEXT DEFAULT 'alpaca_ws',
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_latest_options_root ON latest_options_quotes (root_symbol);

-- ============================================================
-- 5. 新闻表
-- ============================================================
CREATE TABLE IF NOT EXISTS news (
    id              TEXT PRIMARY KEY,
    headline        TEXT,
    summary         TEXT,
    author          TEXT,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ,
    symbols         TEXT[],               -- 相关股票代码数组
    source          TEXT,
    url             TEXT,
    content         JSONB                 -- 原始 JSON
);

SELECT create_hypertable('news', 'created_at', chunk_time_interval => INTERVAL '30 days', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_news_symbols ON news USING GIN (symbols);
CREATE INDEX IF NOT EXISTS idx_news_created ON news (created_at DESC);

ALTER TABLE news SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'source',
    timescaledb.compress_orderby = 'created_at DESC'
);
SELECT add_compression_policy('news', INTERVAL '30 days', if_not_exists => TRUE);

-- ============================================================
-- 6. 数据回填追踪表
-- ============================================================
CREATE TABLE IF NOT EXISTS backfill_log (
    id              SERIAL PRIMARY KEY,
    symbol          TEXT NOT NULL,
    data_type       TEXT NOT NULL,        -- 'bars', 'options_bars', 'news', etc.
    timeframe       TEXT,
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    status          TEXT DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed'
    records_inserted INT DEFAULT 0,
    error_message   TEXT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backfill_status ON backfill_log (status, data_type);
CREATE INDEX IF NOT EXISTS idx_backfill_symbol ON backfill_log (symbol, data_type);

-- ============================================================
-- 7. 数据库统计视图
-- ============================================================
CREATE OR REPLACE VIEW v_db_stats AS
SELECT
    'bars' AS table_name,
    COUNT(*) AS total_rows,
    COUNT(DISTINCT symbol) AS unique_symbols,
    MIN(ts) AS earliest_ts,
    MAX(ts) AS latest_ts,
    NOW() - MAX(ts) AS data_lag
FROM bars
UNION ALL
SELECT
    'options_bars' AS table_name,
    COUNT(*) AS total_rows,
    COUNT(DISTINCT symbol) AS unique_symbols,
    MIN(ts) AS earliest_ts,
    MAX(ts) AS latest_ts,
    NOW() - MAX(ts) AS data_lag
FROM options_bars
UNION ALL
SELECT
    'latest_quotes' AS table_name,
    COUNT(*) AS total_rows,
    COUNT(DISTINCT symbol) AS unique_symbols,
    MIN(updated_at) AS earliest_ts,
    MAX(updated_at) AS latest_ts,
    NOW() - MAX(updated_at) AS data_lag
FROM latest_quotes
UNION ALL
SELECT
    'news' AS table_name,
    COUNT(*) AS total_rows,
    COUNT(DISTINCT id) AS unique_symbols,
    MIN(created_at) AS earliest_ts,
    MAX(created_at) AS latest_ts,
    NOW() - MAX(created_at) AS data_lag
FROM news
UNION ALL
SELECT
    'option_contracts' AS table_name,
    COUNT(*) AS total_rows,
    COUNT(DISTINCT root_symbol) AS unique_symbols,
    MIN(discovered_at) AS earliest_ts,
    MAX(last_scanned_at) AS latest_ts,
    NOW() - MAX(last_scanned_at) AS data_lag
FROM option_contracts;

-- ============================================================
-- 8. 常用查询函数
-- ============================================================

-- 获取某股票某时间范围内的 bars (用于 REST API)
CREATE OR REPLACE FUNCTION get_bars(
    p_symbol TEXT,
    p_timeframe TEXT,
    p_start TIMESTAMPTZ,
    p_end TIMESTAMPTZ,
    p_limit INT DEFAULT 10000
)
RETURNS TABLE (
    t TIMESTAMPTZ,
    o DOUBLE PRECISION,
    h DOUBLE PRECISION,
    l DOUBLE PRECISION,
    c DOUBLE PRECISION,
    v BIGINT,
    vw DOUBLE PRECISION,
    n INT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        bars.ts AS t,
        bars.open AS o,
        bars.high AS h,
        bars.low AS l,
        bars.close AS c,
        bars.volume AS v,
        bars.vwap AS vw,
        bars.trade_count AS n
    FROM bars
    WHERE bars.symbol = p_symbol
      AND bars.timeframe = p_timeframe
      AND bars.ts BETWEEN p_start AND p_end
    ORDER BY bars.ts DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- 获取某期权某时间范围内的 bars
CREATE OR REPLACE FUNCTION get_options_bars(
    p_symbol TEXT,
    p_timeframe TEXT,
    p_start TIMESTAMPTZ,
    p_end TIMESTAMPTZ,
    p_limit INT DEFAULT 10000
)
RETURNS TABLE (
    t TIMESTAMPTZ,
    o DOUBLE PRECISION,
    h DOUBLE PRECISION,
    l DOUBLE PRECISION,
    c DOUBLE PRECISION,
    v BIGINT,
    vw DOUBLE PRECISION,
    n INT,
    oi BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        options_bars.ts AS t,
        options_bars.open AS o,
        options_bars.high AS h,
        options_bars.low AS l,
        options_bars.close AS c,
        options_bars.volume AS v,
        options_bars.vwap AS vw,
        options_bars.trade_count AS n,
        options_bars.open_interest AS oi
    FROM options_bars
    WHERE options_bars.symbol = p_symbol
      AND options_bars.timeframe = p_timeframe
      AND options_bars.ts BETWEEN p_start AND p_end
    ORDER BY options_bars.ts DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- 检查某符号的数据覆盖范围
CREATE OR REPLACE FUNCTION check_data_coverage(
    p_symbol TEXT,
    p_data_type TEXT DEFAULT 'bars'
)
RETURNS TABLE (
    earliest_date DATE,
    latest_date DATE,
    total_days INT,
    gap_days INT[]
) AS $$
DECLARE
    v_earliest DATE;
    v_latest DATE;
    v_total INT;
    v_gaps INT[] := ARRAY[]::INT[];
BEGIN
    IF p_data_type = 'bars' THEN
        SELECT MIN(ts)::DATE, MAX(ts)::DATE, COUNT(DISTINCT ts::DATE)
        INTO v_earliest, v_latest, v_total
        FROM bars WHERE symbol = p_symbol;
    ELSIF p_data_type = 'options_bars' THEN
        SELECT MIN(ts)::DATE, MAX(ts)::DATE, COUNT(DISTINCT ts::DATE)
        INTO v_earliest, v_latest, v_total
        FROM options_bars WHERE symbol = p_symbol;
    END IF;

    RETURN QUERY SELECT v_earliest, v_latest, v_total, v_gaps;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- 9. 自动更新时间戳触发器
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_bars_updated_at BEFORE UPDATE ON bars
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_options_bars_updated_at BEFORE UPDATE ON options_bars
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_latest_quotes_updated_at BEFORE UPDATE ON latest_quotes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_latest_options_quotes_updated_at BEFORE UPDATE ON latest_options_quotes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 10. 权限设置
-- ============================================================
-- 确保 proxy 用户有全部权限
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO proxy;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO proxy;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO proxy;

-- 默认权限：未来创建的表也自动授权
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO proxy;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO proxy;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO proxy;

-- ============================================================
-- 完成
-- ============================================================
SELECT 'TimescaleDB schema initialized successfully' AS status;
