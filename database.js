// database.js - Thread-Safe SQLite Database Manager (Fixed Version)
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const colors = require('colors');

const DB_NAME = 'jaseb_system.db';

// Create database connection pool
class DatabaseManager {
    constructor() {
        try {
            this.db = new sqlite3.Database(DB_NAME, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
                if (err) {
                    console.error('[DB ERROR]'.red + ' Database connection error:', err);
                    process.exit(1);
                } else {
                    console.log('[DB]'.green + ' Database siap digunakan.');
                }
            });

            // Enable foreign keys and WAL mode for better performance
            this.db.configure("busyTimeout", 5000);
            this.db.run("PRAGMA foreign_keys = ON");
            this.db.run("PRAGMA journal_mode = WAL");

            this.initDB();
        } catch (error) {
            console.error('[DB FATAL]'.red + ' Cannot initialize database:', error);
            process.exit(1);
        }
    }

    initDB() {
        const queries = [
            'CREATE TABLE IF NOT EXISTS users (user_id INTEGER PRIMARY KEY, first_name TEXT, username TEXT, join_date TEXT)',
            'CREATE TABLE IF NOT EXISTS subscriptions (user_id INTEGER PRIMARY KEY, end_date TEXT)',
            'CREATE TABLE IF NOT EXISTS userbots (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER, session_string TEXT UNIQUE, userbot_id INTEGER UNIQUE, userbot_name TEXT, status TEXT DEFAULT "pending", is_running_worker BOOLEAN DEFAULT 0)',
            'CREATE TABLE IF NOT EXISTS jaseb_config (userbot_id INTEGER PRIMARY KEY, message_type TEXT, message_text TEXT, message_file_id TEXT, is_running BOOLEAN DEFAULT 0, delay_per_group INTEGER DEFAULT 20, pm_reply_status BOOLEAN DEFAULT 0, pm_reply_text TEXT, promo_status BOOLEAN DEFAULT 0, promo_keywords TEXT, promo_message TEXT, message_entities TEXT)',
            'CREATE TABLE IF NOT EXISTS banned_groups (userbot_id INTEGER, chat_id INTEGER, reason TEXT, banned_until TEXT, PRIMARY KEY (userbot_id, chat_id))',
            'CREATE TABLE IF NOT EXISTS redeem_codes (code TEXT PRIMARY KEY, duration_days INTEGER, is_used BOOLEAN DEFAULT 0, used_by INTEGER, used_date TEXT)',
            'CREATE TABLE IF NOT EXISTS promo_settings (id INTEGER PRIMARY KEY DEFAULT 1, keywords TEXT DEFAULT "jaseb,sebar", message TEXT DEFAULT "Butuh Jasa Sebar Profesional? Hubungi kami!")',
            'CREATE TABLE IF NOT EXISTS jaseb_logs (log_id INTEGER PRIMARY KEY AUTOINCREMENT, userbot_id INTEGER, timestamp TEXT, log_text TEXT)',
            'CREATE TABLE IF NOT EXISTS auto_chat_config (userbot_id INTEGER PRIMARY KEY, auto_chat_status BOOLEAN DEFAULT 0, auto_chat_target TEXT, auto_chat_delay INTEGER DEFAULT 30, auto_chat_message_type TEXT, auto_chat_message_text TEXT, auto_chat_message_file_id TEXT, auto_chat_message_entities TEXT)',
            'CREATE TABLE IF NOT EXISTS auto_join_config (userbot_id INTEGER PRIMARY KEY, auto_join_status BOOLEAN DEFAULT 0, auto_join_target TEXT, auto_join_delay INTEGER DEFAULT 60, join_count INTEGER DEFAULT 0, last_break_time TEXT)'
        ];

        queries.forEach(query => {
            this.db.run(query, (err) => {
                if (err && !err.message.includes('duplicate column')) {
                    console.error('Database init error:', err);
                }
            });
        });

        // Add missing columns if they don't exist
        const alterQueries = [
            'ALTER TABLE userbots ADD COLUMN is_running_worker BOOLEAN DEFAULT 0',
            'ALTER TABLE jaseb_config ADD COLUMN pm_reply_status BOOLEAN DEFAULT 0',
            'ALTER TABLE jaseb_config ADD COLUMN pm_reply_text TEXT',
            'ALTER TABLE jaseb_config ADD COLUMN promo_status BOOLEAN DEFAULT 0',
            'ALTER TABLE jaseb_config ADD COLUMN promo_keywords TEXT',
            'ALTER TABLE jaseb_config ADD COLUMN promo_message TEXT',
            'ALTER TABLE jaseb_config ADD COLUMN message_entities TEXT',
            'ALTER TABLE banned_groups ADD COLUMN banned_until TEXT'
        ];

        alterQueries.forEach(query => {
            this.db.run(query, () => {}); // Ignore errors for existing columns
        });

        // Initialize default promo settings
        this.db.run("INSERT OR IGNORE INTO promo_settings (id, keywords, message) VALUES (1, 'jaseb,sebar', 'Butuh Jasa Sebar Profesional? Hubungi kami!')", () => {});
    }

    // Utility functions
    getCurrentTimestamp() {
        return new Date().toISOString().replace('T', ' ').substring(0, 19);
    }

    addUser(user_id, first_name, username) {
        return new Promise((resolve, reject) => {
            const timestamp = this.getCurrentTimestamp();
            this.db.run("INSERT OR REPLACE INTO users (user_id, first_name, username, join_date) VALUES (?, ?, ?, ?)", 
                [user_id, first_name, username, timestamp], (err) => {
                    if (err) {
                        console.error('[DB]'.red + ' Error adding user:', err);
                        reject(err);
                    } else {
                        console.log(`[DB]`.green + ` User ${user_id} (${first_name}) added/updated successfully`);
                        resolve();
                    }
                });
        });
    }

    isUserRegistered(user_id) {
        return new Promise((resolve, reject) => {
            this.db.get("SELECT user_id FROM users WHERE user_id = ?", [user_id], (err, row) => {
                if (err) {
                    console.error('[DB]'.red + ' Error checking user registration:', err);
                    reject(err);
                } else {
                    const isRegistered = row !== undefined && row !== null;
                    console.log(`[DB]`.yellow + ` User ${user_id} registration check: ${isRegistered}`);
                    resolve(isRegistered);
                }
            });
        });
    }

    addSubscription(user_id, duration_days) {
        return new Promise((resolve, reject) => {
            this.db.get("SELECT end_date FROM subscriptions WHERE user_id = ?", [user_id], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }

                let base_date = new Date();
                if (row && new Date(row.end_date) > base_date) {
                    base_date = new Date(row.end_date);
                }

                const end_date = new Date(base_date.getTime() + duration_days * 24 * 60 * 60 * 1000);
                const end_date_str = end_date.toISOString().replace('T', ' ').substring(0, 19);

                this.db.run("INSERT OR REPLACE INTO subscriptions (user_id, end_date) VALUES (?, ?)", 
                    [user_id, end_date_str], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
            });
        });
    }

    isUserSubscribed(user_id) {
        return new Promise((resolve, reject) => {
            // ENHANCED: Always check if user is admin first - FORCE OVERRIDE
            const config = require('./config');
            const userId = parseInt(user_id);
            if (config.ADMIN_IDS && config.ADMIN_IDS.includes(userId)) {
                console.log(`[DB ADMIN OVERRIDE]`.green + ` ADMIN ${userId} - FORCE GRANTED subscription access`);
                resolve(true);
                return;
            }

            this.db.get("SELECT end_date FROM subscriptions WHERE user_id = ?", [user_id], (err, row) => {
                if (err) {
                    console.error(`[DB]`.red + ` Error checking subscription for ${user_id}:`, err);
                    reject(err);
                    return;
                }
                if (!row) {
                    console.log(`[DB]`.yellow + ` User ${user_id} - No subscription found`);
                    resolve(false);
                    return;
                }
                const isActive = new Date() < new Date(row.end_date);
                console.log(`[DB]`.cyan + ` User ${user_id} subscription status: ${isActive} (expires: ${row.end_date})`);
                resolve(isActive);
            });
        });
    }

    getSubscriptionEndDate(user_id) {
        return new Promise((resolve, reject) => {
            this.db.get("SELECT end_date FROM subscriptions WHERE user_id = ?", [user_id], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(row ? row.end_date : "Tidak Terdaftar");
            });
        });
    }

    getUserbotsByOwner(owner_id) {
        return new Promise((resolve, reject) => {
            const config = require('./config');
            const ownerId = parseInt(owner_id);
            const isAdmin = config.ADMIN_IDS && config.ADMIN_IDS.includes(ownerId);

            console.log(`[DB ADMIN CHECK]`.yellow + ` Checking admin status for ${owner_id}: ${isAdmin} (Admin IDs: ${JSON.stringify(config.ADMIN_IDS)})`);

            // FIRST: Debug information
            this.db.get("SELECT COUNT(*) as total FROM userbots", [], (countErr, countRow) => {
                if (!countErr && countRow) {
                    console.log(`[DB TOTAL COUNT]`.blue + ` Total userbots in database: ${countRow.total}`);
                }

                this.db.get("SELECT COUNT(*) as active FROM userbots WHERE status = 'active'", [], (activeErr, activeRow) => {
                    if (!activeErr && activeRow) {
                        console.log(`[DB ACTIVE COUNT]`.blue + ` Active userbots in database: ${activeRow.active}`);
                    }

                    // COMPLETELY FIXED: Enhanced query with better validation
                    let query, params;

                    if (isAdmin) {
                        // ADMIN: Get ALL active userbots with comprehensive filtering
                        query = `
                            SELECT userbot_id, userbot_name, status, is_running_worker, owner_id 
                            FROM userbots 
                            WHERE status = 'active' 
                            AND userbot_id IS NOT NULL 
                            AND userbot_name IS NOT NULL 
                            AND userbot_name != ''
                            AND LENGTH(userbot_name) > 2
                            AND CAST(userbot_id AS TEXT) NOT LIKE 'UserBot_%'
                            AND userbot_name NOT LIKE 'UserBot_%'
                            AND userbot_name NOT LIKE 'Bot-%'
                            AND userbot_name NOT LIKE 'User_%'
                            AND CAST(userbot_id AS INTEGER) >= 1000000000
                            AND CAST(userbot_id AS INTEGER) <= 9999999999
                            ORDER BY owner_id ASC, userbot_name ASC
                        `;
                        params = [];
                        console.log(`[DB ADMIN QUERY]`.green + ` Admin ${owner_id} requesting ALL validated userbots`);
                    } else {
                        // REGULAR USER: Get only owned userbots with comprehensive filtering
                        query = `
                            SELECT userbot_id, userbot_name, status, is_running_worker, owner_id 
                            FROM userbots 
                            WHERE owner_id = ? 
                            AND status = 'active' 
                            AND userbot_id IS NOT NULL 
                            AND userbot_name IS NOT NULL 
                            AND userbot_name != ''
                            AND LENGTH(userbot_name) > 2
                            AND CAST(userbot_id AS TEXT) NOT LIKE 'UserBot_%'
                            AND userbot_name NOT LIKE 'UserBot_%'
                            AND userbot_name NOT LIKE 'Bot-%'
                            AND userbot_name NOT LIKE 'User_%'
                            AND CAST(userbot_id AS INTEGER) >= 1000000000
                            AND CAST(userbot_id AS INTEGER) <= 9999999999
                            ORDER BY userbot_name ASC
                        `;
                        params = [owner_id];
                        console.log(`[DB USER QUERY]`.cyan + ` User ${owner_id} requesting owned validated userbots`);
                    }

                    console.log(`[DB QUERY EXECUTION]`.yellow + ` SQL: ${query.replace(/\s+/g, ' ').trim()}`);
                    console.log(`[DB QUERY PARAMS]`.yellow + ` Params: ${JSON.stringify(params)}`);

                    this.db.all(query, params, (err, rows) => {
                        if (err) {
                            console.error(`[DB ERROR]`.red + ` Database error for ${isAdmin ? 'admin' : 'user'} ${owner_id}:`, err);
                            reject(err);
                            return;
                        }

                        console.log(`[DB RAW RESULT]`.yellow + ` Raw query returned ${rows ? rows.length : 0} rows`);

                        if (!rows || rows.length === 0) {
                            console.log(`[DB EMPTY RESULT]`.yellow + ` No userbots found, checking database content...`);

                            // Debug what's actually in the database
                            this.db.all("SELECT userbot_id, userbot_name, status, owner_id FROM userbots ORDER BY id DESC LIMIT 3", [], (debugErr, debugRows) => {
                                if (!debugErr && debugRows) {
                                    console.log(`[DB DEBUG CONTENT]`.cyan + ` Latest userbots in database: ${JSON.stringify(debugRows, null, 2)}`);
                                }
                            });

                            resolve([]);
                            return;
                        }

                        // Enhanced validation to ensure real telegram data integrity
                        const validRows = rows.filter(row => {
                            const hasValidId = row.userbot_id && typeof row.userbot_id === 'number' && row.userbot_id >= 1000000000;
                            const hasValidName = row.userbot_name && typeof row.userbot_name === 'string' && row.userbot_name.trim() !== '';
                            const isNotDummyName = !row.userbot_name.includes('UserBot_') && !row.userbot_name.includes('Bot-');
                            const isNotDummyId = !String(row.userbot_id).includes('UserBot_');
                            const isActive = row.status === 'active';
                            const hasRealisticId = row.userbot_id <= 9999999999; // Telegram ID limit

                            const isValid = hasValidId && hasValidName && isNotDummyName && isNotDummyId && isActive && hasRealisticId;

                            if (!isValid) {
                                console.log(`[DB INVALID ROW]`.red + ` Skipping invalid/dummy userbot: ID:${row.userbot_id}, Name:'${row.userbot_name}', Status:${row.status}`);
                            } else {
                                console.log(`[DB VALID ROW]`.green + ` Valid real telegram userbot: ${row.userbot_id} (${row.userbot_name}) owner:${row.owner_id}`);
                            }

                            return isValid;
                        });

                        console.log(`[DB FINAL RESULT]`.green + ` ${isAdmin ? 'Admin' : 'User'} ${owner_id} - Found ${validRows.length} valid userbots (from ${rows.length} raw)`);

                        // List all valid userbots for debugging
                        if (validRows.length > 0) {
                            validRows.forEach((row, index) => {
                                const ownerInfo = isAdmin && row.owner_id !== owner_id ? ` (Owner: ${row.owner_id})` : '';
                                console.log(`[DB USERBOT ${index + 1}]`.green + ` ${row.userbot_id} (${row.userbot_name})${ownerInfo} - Status: ${row.status}`);
                            });
                        } else {
                            console.log(`[DB NO VALID USERBOTS]`.yellow + ` All userbots failed validation for ${isAdmin ? 'admin' : 'user'} ${owner_id}`);
                        }

                        resolve(validRows);
                    });
                });
            });
        });
    }

    getSystemStats() {
        return new Promise((resolve, reject) => {
            const stats = {};

            this.db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                stats.total_users = row.count;

                this.db.get("SELECT COUNT(*) as count FROM subscriptions WHERE end_date > ?", 
                    [this.getCurrentTimestamp()], (err, row) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        stats.active_subscriptions = row.count;

                        // ENHANCED: Count REAL userbots that are fully active and valid
                        this.db.get(`
                            SELECT COUNT(*) as count FROM userbots 
                            WHERE status = 'active' 
                            AND userbot_id IS NOT NULL 
                            AND userbot_name IS NOT NULL
                            AND userbot_name != ''
                            AND CAST(userbot_id AS INTEGER) > 100000000
                        `, (err, row) => {
                            if (err) reject(err);
                            else {
                                stats.active_userbots = row.count;
                                console.log(`[DB STATS]`.cyan + ` REAL active userbots count: ${row.count}`);
                                resolve(stats);
                            }
                        });
                    });
            });
        });
    }

    addUserbotSession(owner_id, session_string) {
        return new Promise((resolve, reject) => {
            this.db.run("INSERT INTO userbots (owner_id, session_string) VALUES (?, ?)", 
                [owner_id, session_string], (err) => {
                    if (err) {
                        if (err.code === 'SQLITE_CONSTRAINT') {
                            resolve(false);
                        } else {
                            reject(err);
                        }
                    } else {
                        resolve(true);
                    }
                });
        });
    }

    getAllSubscriptions() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT s.user_id, u.first_name, u.join_date, s.end_date, 
                       (SELECT COUNT(*) FROM userbots WHERE owner_id=s.user_id AND status='active') as bot_count 
                FROM subscriptions s 
                JOIN users u ON s.user_id = u.user_id 
                ORDER BY s.end_date DESC
            `;
            this.db.all(query, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    saveRedeemCode(code, duration_days) {
        return new Promise((resolve, reject) => {
            this.db.run("INSERT OR IGNORE INTO redeem_codes (code, duration_days) VALUES (?, ?)", 
                [code, duration_days], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
    }

    redeemCode(code, user_id) {
        return new Promise((resolve, reject) => {
            this.db.get("SELECT duration_days, is_used FROM redeem_codes WHERE code = ?", [code], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                if (!row) {
                    resolve("NOT_FOUND");
                    return;
                }
                if (row.is_used) {
                    resolve("ALREADY_USED");
                    return;
                }

                this.addSubscription(user_id, row.duration_days).then(() => {
                    this.db.run("UPDATE redeem_codes SET is_used = 1, used_by = ?, used_date = ? WHERE code = ?", 
                        [user_id, this.getCurrentTimestamp(), code], (err) => {
                            if (err) reject(err);
                            else resolve(row.duration_days);
                        });
                }).catch(reject);
            });
        });
    }

    getAllUserIds() {
        return new Promise((resolve, reject) => {
            this.db.all("SELECT user_id FROM users", (err, rows) => {
                if (err) reject(err);
                else resolve(rows.map(row => row.user_id));
            });
        });
    }

    getDefaultPromoSettings() {
        return new Promise((resolve, reject) => {
            this.db.get("SELECT keywords, message FROM promo_settings WHERE id = 1", (err, row) => {
                if (err) reject(err);
                else resolve(row ? [row.keywords, row.message] : ["jaseb,sebar", "Butuh Jasa Sebar Profesional? Hubungi kami!"]);
            });
        });
    }

    setDefaultPromoSettings(keywords = null, message = null) {
        return new Promise((resolve, reject) => {
            const updates = [];
            const params = [];

            if (keywords !== null) {
                updates.push("keywords = ?");
                params.push(keywords);
            }
            if (message !== null) {
                updates.push("message = ?");
                params.push(message);
            }

            if (updates.length > 0) {
                this.db.run(`UPDATE promo_settings SET ${updates.join(', ')} WHERE id = 1`, params, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            } else {
                resolve();
            }
        });
    }

    getJasebConfig(userbot_id) {
        return new Promise((resolve, reject) => {
            this.db.get("SELECT * FROM jaseb_config WHERE userbot_id = ?", [userbot_id], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                if (!row) {
                    resolve(null);
                    return;
                }

                let entities = null;
                if (row.message_entities) {
                    try {
                        entities = JSON.parse(row.message_entities);
                    } catch (e) {
                        entities = null;
                    }
                }

                resolve({
                    type: row.message_type,
                    text: row.message_text,
                    file_id: row.message_file_id,
                    running: Boolean(row.is_running),
                    delay: row.delay_per_group,
                    pm_reply_status: Boolean(row.pm_reply_status),
                    pm_reply_text: row.pm_reply_text,
                    promo_status: Boolean(row.promo_status),
                    promo_keywords: row.promo_keywords,
                    promo_message: row.promo_message,
                    message_entities: entities
                });
            });
        });
    }

    setJasebMessage(userbot_id, message_type, text = null, file_id = null, entities = null) {
        return new Promise((resolve, reject) => {
            const entities_json = entities ? JSON.stringify(entities) : null;
            this.db.run("INSERT OR REPLACE INTO jaseb_config (userbot_id, message_type, message_text, message_file_id, message_entities) VALUES (?, ?, ?, ?, ?)", 
                [userbot_id, message_type, text, file_id, entities_json], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
    }

    setJasebDelay(userbot_id, delay_seconds) {
        return new Promise((resolve, reject) => {
            this.db.run("INSERT OR IGNORE INTO jaseb_config (userbot_id) VALUES (?)", [userbot_id], (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                this.db.run("UPDATE jaseb_config SET delay_per_group = ? WHERE userbot_id = ?", 
                    [delay_seconds, userbot_id], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
            });
        });
    }

    toggleJasebStatus(userbot_id) {
        return new Promise((resolve, reject) => {
            this.db.get("SELECT is_running FROM jaseb_config WHERE userbot_id = ?", [userbot_id], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }

                if (!row) {
                    this.db.run("INSERT OR IGNORE INTO jaseb_config (userbot_id) VALUES (?)", [userbot_id], (err) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        this.db.run("UPDATE jaseb_config SET is_running = 1 WHERE userbot_id = ?", [userbot_id], (err) => {
                            if (err) reject(err);
                            else resolve(true);
                        });
                    });
                } else {
                    const new_status = !Boolean(row.is_running);
                    this.db.run("UPDATE jaseb_config SET is_running = ? WHERE userbot_id = ?", 
                        [new_status ? 1 : 0, userbot_id], (err) => {
                            if (err) reject(err);
                            else resolve(new_status);
                        });
                }
            });
        });
    }

    setPmReplyStatus(userbot_id, status) {
        return new Promise((resolve, reject) => {
            this.db.run("INSERT OR IGNORE INTO jaseb_config (userbot_id) VALUES (?)", [userbot_id], (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                this.db.run("UPDATE jaseb_config SET pm_reply_status = ? WHERE userbot_id = ?", 
                    [status ? 1 : 0, userbot_id], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
            });
        });
    }

    setPmReplyText(userbot_id, text) {
        return new Promise((resolve, reject) => {
            this.db.run("INSERT OR IGNORE INTO jaseb_config (userbot_id) VALUES (?)", [userbot_id], (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                this.db.run("UPDATE jaseb_config SET pm_reply_text = ? WHERE userbot_id = ?", 
                    [text, userbot_id], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
            });
        });
    }

    setUserbotPromoConfig(userbot_id, status = null, keywords = null, message = null) {
        return new Promise((resolve, reject) => {
            this.db.run("INSERT OR IGNORE INTO jaseb_config (userbot_id) VALUES (?)", [userbot_id], (err) => {
                if (err) {
                    reject(err);
                    return;
                }

                const updates = [];
                const params = [];

                if (status !== null) {
                    updates.push("promo_status = ?");
                    params.push(status ? 1 : 0);
                }
                if (keywords !== null) {
                    updates.push("promo_keywords = ?");
                    params.push(keywords);
                }
                if (message !== null) {
                    updates.push("promo_message = ?");
                    params.push(message);
                }

                if (updates.length > 0) {
                    params.push(userbot_id);
                    this.db.run(`UPDATE jaseb_config SET ${updates.join(', ')} WHERE userbot_id = ?`, params, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                } else {
                    resolve();
                }
            });
        });
    }

    addJasebLog(userbot_id, log_text) {
        return new Promise((resolve, reject) => {
            this.db.run("INSERT INTO jaseb_logs (userbot_id, timestamp, log_text) VALUES (?, ?, ?)", 
                [userbot_id, this.getCurrentTimestamp(), log_text], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
    }

    getLatestJasebLogs(userbot_id, limit = 10) {
        return new Promise((resolve, reject) => {
            this.db.all("SELECT timestamp, log_text FROM jaseb_logs WHERE userbot_id = ? ORDER BY log_id DESC LIMIT ?", 
                [userbot_id, limit], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
        });
    }

    addBannedGroup(userbot_id, chat_id, reason, ban_duration_hours = 1) {
        return new Promise((resolve, reject) => {
            const banned_until = new Date(Date.now() + ban_duration_hours * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);
            this.db.run("INSERT OR REPLACE INTO banned_groups (userbot_id, chat_id, reason, banned_until) VALUES (?, ?, ?, ?)", 
                [userbot_id, chat_id, reason, banned_until], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
    }

    getBannedGroupIds(userbot_id) {
        return new Promise((resolve, reject) => {
            const now = this.getCurrentTimestamp();
            this.db.all("SELECT chat_id FROM banned_groups WHERE userbot_id = ? AND banned_until > ?", 
                [userbot_id, now], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows.map(row => row.chat_id));
                });
        });
    }

    // Userbot manager methods
    fetchAndClaimPendingUserbots() {
        return new Promise((resolve, reject) => {
            this.db.all("SELECT id, owner_id, session_string FROM userbots WHERE status = 'pending'", (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                if (rows.length === 0) {
                    resolve([]);
                    return;
                }

                const ids = rows.map(row => row.id);
                const placeholders = ids.map(() => '?').join(',');

                this.db.run(`UPDATE userbots SET status = 'activating' WHERE id IN (${placeholders})`, ids, (err) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
        });
    }

    updateUserbotDetails(session_string, userbot_id, userbot_name) {
        return new Promise((resolve, reject) => {
            this.db.run("UPDATE userbots SET userbot_id = ?, userbot_name = ?, status = 'active' WHERE session_string = ?", 
                [userbot_id, userbot_name, session_string], (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    this.getDefaultPromoSettings().then(([promo_keywords, promo_message]) => {
                        this.db.run("INSERT OR IGNORE INTO jaseb_config (userbot_id, promo_keywords, promo_message, promo_status) VALUES (?, ?, ?, 1)", 
                            [userbot_id, promo_keywords, promo_message], (err) => {
                                if (err) reject(err);
                                else resolve();
                            });
                    }).catch(reject);
                });
        });
    }

    setUserbotError(session_string, error_message) {
        return new Promise((resolve, reject) => {
            const status = `error: ${error_message.substring(0, 100)}`;
            this.db.run("UPDATE userbots SET status = ? WHERE session_string = ?", 
                [status, session_string], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
    }

    setWorkerStatus(userbot_id, status) {
        return new Promise((resolve, reject) => {
            this.db.run("UPDATE userbots SET is_running_worker = ? WHERE userbot_id = ?", 
                [status ? 1 : 0, userbot_id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
    }

    resetAllWorkerStatuses() {
        return new Promise((resolve, reject) => {
            this.db.run("UPDATE userbots SET is_running_worker = 0", (err) => {
                if (err) reject(err);
                else {
                    console.log("[DB]".green + " Semua status worker telah direset.");
                    resolve();
                }
            });
        });
    }

    getIdleActiveUserbots() {
        return new Promise((resolve, reject) => {
            this.db.all("SELECT session_string, userbot_id, owner_id, userbot_name FROM userbots WHERE status = 'active' AND is_running_worker = 0", 
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
        });
    }

    countRunningWorkers() {
        return new Promise((resolve, reject) => {
            this.db.get("SELECT COUNT(*) as count FROM userbots WHERE status = 'active' AND is_running_worker = 1", 
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row.count);
                });
        });
    }

    // Auto Chat Member methods
    getAutoChatConfig(userbot_id) {
        return new Promise((resolve, reject) => {
            this.db.get("SELECT * FROM auto_chat_config WHERE userbot_id = ?", [userbot_id], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                if (!row) {
                    resolve(null);
                    return;
                }

                let entities = null;
                if (row.auto_chat_message_entities) {
                    try {
                        entities = JSON.parse(row.auto_chat_message_entities);
                    } catch (e) {
                        entities = null;
                    }
                }

                resolve({
                    auto_chat_status: Boolean(row.auto_chat_status),
                    auto_chat_target: row.auto_chat_target,
                    auto_chat_delay: row.auto_chat_delay,
                    auto_chat_message_type: row.auto_chat_message_type,
                    auto_chat_message: row.auto_chat_message_text,
                    auto_chat_file_id: row.auto_chat_message_file_id,
                    auto_chat_entities: entities
                });
            });
        });
    }

    setAutoChatStatus(userbot_id, status) {
        return new Promise((resolve, reject) => {
            this.db.run("INSERT OR IGNORE INTO auto_chat_config (userbot_id) VALUES (?)", [userbot_id], (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                this.db.run("UPDATE auto_chat_config SET auto_chat_status = ? WHERE userbot_id = ?", 
                    [status ? 1 : 0, userbot_id], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
            });
        });
    }

    setAutoChatTarget(userbot_id, target) {
        return new Promise((resolve, reject) => {
            this.db.run("INSERT OR IGNORE INTO auto_chat_config (userbot_id) VALUES (?)", [userbot_id], (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                this.db.run("UPDATE auto_chat_config SET auto_chat_target = ? WHERE userbot_id = ?", 
                    [target, userbot_id], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
            });
        });
    }

    setAutoChatDelay(userbot_id, delay) {
        return new Promise((resolve, reject) => {
            this.db.run("INSERT OR IGNORE INTO auto_chat_config (userbot_id) VALUES (?)", [userbot_id], (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                this.db.run("UPDATE auto_chat_config SET auto_chat_delay = ? WHERE userbot_id = ?", 
                    [delay, userbot_id], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
            });
        });
    }

    setAutoChatMessage(userbot_id, type, text = null, file_id = null, entities = null) {
        return new Promise((resolve, reject) => {
            const entities_json = entities ? JSON.stringify(entities) : null;
            this.db.run("INSERT OR IGNORE INTO auto_chat_config (userbot_id) VALUES (?)", [userbot_id], (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                this.db.run("UPDATE auto_chat_config SET auto_chat_message_type = ?, auto_chat_message_text = ?, auto_chat_message_file_id = ?, auto_chat_message_entities = ? WHERE userbot_id = ?", 
                    [type, text, file_id, entities_json, userbot_id], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
            });
        });
    }

    // Auto Join Group methods
    getAutoJoinConfig(userbot_id) {
        return new Promise((resolve, reject) => {
            this.db.get("SELECT * FROM auto_join_config WHERE userbot_id = ?", [userbot_id], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                if (!row) {
                    resolve(null);
                    return;
                }

                resolve({
                    auto_join_status: Boolean(row.auto_join_status),
                    auto_join_target: row.auto_join_target,
                    auto_join_delay: row.auto_join_delay,
                    join_count: row.join_count,
                    last_break_time: row.last_break_time
                });
            });
        });
    }

    setAutoJoinStatus(userbot_id, status) {
        return new Promise((resolve, reject) => {
            this.db.run("INSERT OR IGNORE INTO auto_join_config (userbot_id) VALUES (?)", [userbot_id], (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                this.db.run("UPDATE auto_join_config SET auto_join_status = ? WHERE userbot_id = ?", 
                    [status ? 1 : 0, userbot_id], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
            });
        });
    }

    setAutoJoinTarget(userbot_id, target) {
        return new Promise((resolve, reject) => {
            this.db.run("INSERT OR IGNORE INTO auto_join_config (userbot_id) VALUES (?)", [userbot_id], (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                this.db.run("UPDATE auto_join_config SET auto_join_target = ? WHERE userbot_id = ?", 
                    [target, userbot_id], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
            });
        });
    }

    setAutoJoinDelay(userbot_id, delay) {
        return new Promise((resolve, reject) => {
            this.db.run("INSERT OR IGNORE INTO auto_join_config (userbot_id) VALUES (?)", [userbot_id], (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                this.db.run("UPDATE auto_join_config SET auto_join_delay = ? WHERE userbot_id = ?", 
                    [delay, userbot_id], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
            });
        });
    }

    updateAutoJoinCount(userbot_id, count) {
        return new Promise((resolve, reject) => {
            this.db.run("UPDATE auto_join_config SET join_count = ? WHERE userbot_id = ?", 
                [count, userbot_id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
    }

    updateAutoJoinBreakTime(userbot_id) {
        return new Promise((resolve, reject) => {
            const breakTime = this.getCurrentTimestamp();
            this.db.run("UPDATE auto_join_config SET last_break_time = ?, join_count = 0 WHERE userbot_id = ?", 
                [breakTime, userbot_id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
    }

    // FIXED: Missing function that caused the error
    updateUserbotRealData(session_string, userbot_id, userbot_name) {
        return new Promise((resolve, reject) => {
            this.db.run("UPDATE userbots SET userbot_id = ?, userbot_name = ?, status = 'active' WHERE session_string = ?", 
                [userbot_id, userbot_name, session_string], (err) => {
                    if (err) {
                        console.error('[DB ERROR]'.red + ' Failed to update userbot real data:', err);
                        reject(err);
                    } else {
                        console.log(`[DB SUCCESS]`.green + ` Updated userbot real data: ${userbot_name} (${userbot_id})`);
                        resolve();
                    }
                });
        });
    }

    // Additional missing functions for complete functionality
    cleanupDummyUserbots() {
        return new Promise((resolve, reject) => {
            this.db.run(`
                DELETE FROM userbots 
                WHERE userbot_name LIKE 'UserBot_%' 
                OR userbot_name LIKE 'Bot-%' 
                OR CAST(userbot_id AS TEXT) LIKE 'UserBot_%'
                OR userbot_id IS NULL 
                OR userbot_name IS NULL 
                OR userbot_name = ''
            `, (err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log('[DB CLEANUP]'.yellow + ' Dummy userbots cleaned up');
                    resolve();
                }
            });
        });
    }

    validateUserbotData(userbot_id) {
        return new Promise((resolve, reject) => {
            this.db.get(`
                SELECT userbot_id, userbot_name, status, owner_id 
                FROM userbots 
                WHERE userbot_id = ? 
                AND status = 'active'
                AND userbot_id IS NOT NULL 
                AND userbot_name IS NOT NULL
                AND userbot_name != ''
                AND CAST(userbot_id AS INTEGER) >= 1000000000
                AND CAST(userbot_id AS TEXT) NOT LIKE 'UserBot_%'
            `, [userbot_id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row ? true : false);
                }
            });
        });
    }
}

// Create singleton instance
const database = new DatabaseManager();

module.exports = database;