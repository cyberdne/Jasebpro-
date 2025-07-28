// mainBot.js - Main Telegram Bot (Fully Fixed & Complete Version)
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const colors = require('colors');
const config = require('./config');
const database = require('./database');

// Bot instance with improved error handling
let bot;
let isPolling = false;

console.log('[BOT INIT]'.yellow + ' Menginisialisasi bot...');

try {
    if (!config.BOT_TOKEN) {
        throw new Error('BOT_TOKEN tidak ditemukan di config.js');
    }

    bot = new TelegramBot(config.BOT_TOKEN, { 
        polling: false,
        request: {
            agentOptions: {
                keepAlive: true,
                family: 4
            }
        },
        onlyFirstMatch: true
    });

} catch (error) {
    console.error('[BOT ERROR]'.red + ' Gagal menginisialisasi bot:', error.message);
    process.exit(1);
}

// Conversation states
const ConversationStates = {
    GET_EXTEND_ID: 'GET_EXTEND_ID',
    GET_EXTEND_DURATION: 'GET_EXTEND_DURATION',
    GET_OWNER_ID_FOR_USERBOT: 'GET_OWNER_ID_FOR_USERBOT',
    GET_SESSION_STRING: 'GET_SESSION_STRING',
    GET_REDEEM_DURATION: 'GET_REDEEM_DURATION',
    GET_BROADCAST_MESSAGE: 'GET_BROADCAST_MESSAGE',
    GET_JASEB_MESSAGE: 'GET_JASEB_MESSAGE',
    GET_JASEB_DELAY: 'GET_JASEB_DELAY',
    GET_PROMO_KEYWORDS: 'GET_PROMO_KEYWORDS',
    GET_PROMO_MESSAGE: 'GET_PROMO_MESSAGE',
    GET_PM_REPLY_TEXT: 'GET_PM_REPLY_TEXT',
    GET_REDEEM_CODE: 'GET_REDEEM_CODE',
    GET_PROMO_USERBOT_KEYWORDS: 'GET_PROMO_USERBOT_KEYWORDS',
    GET_PROMO_USERBOT_MESSAGE: 'GET_PROMO_USERBOT_MESSAGE',
    GET_AUTO_CHAT_TARGET: 'GET_AUTO_CHAT_TARGET',
    GET_AUTO_CHAT_DELAY: 'GET_AUTO_CHAT_DELAY',
    GET_AUTO_CHAT_MESSAGE: 'GET_AUTO_CHAT_MESSAGE',
    GET_AUTO_JOIN_TARGET: 'GET_AUTO_JOIN_TARGET',
    GET_AUTO_JOIN_DELAY: 'GET_AUTO_JOIN_DELAY'
};

// User conversation tracking
const userStates = new Map();
const userData = new Map();

// Cache untuk userbot status (auto-refresh)
const userbotStatusCache = new Map();

// Utility functions
function escapeMarkdown(text) {
    if (!text) return '';
    return text.toString().replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

function logToChannel(level, title, message) {
    if (!config.LOG_CHANNEL_ID) return;

    const icons = {
        'SUCCESS': '✅',
        'ERROR': '❌',
        'WARNING': '⚠️',
        'INFO': '👤',
        'SUMMARY': '📊'
    };
    const icon = icons[level] || '⚙️';
    const formatted_text = `${icon} *${level}: ${title}*\n\n${message}`;

    bot.sendMessage(config.LOG_CHANNEL_ID, formatted_text, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
    }).catch(err => {
        console.warn('[LOG]'.yellow + ' Gagal kirim log ke channel:', err.message);
    });
}

async function sendOrEdit(msg, text, keyboard) {
    const options = {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: keyboard
    };

    try {
        if (msg.message_id && msg.chat) {
            await bot.editMessageText(text, {
                chat_id: msg.chat.id,
                message_id: msg.message_id,
                ...options
            });
            console.log(`[SEND]`.cyan + ` Message edited for chat ${msg.chat.id}`);
        } else {
            const chatId = msg.chat?.id || msg.from?.id;
            if (!chatId) {
                throw new Error('No chat ID available');
            }
            await bot.sendMessage(chatId, text, options);
            console.log(`[SEND]`.cyan + ` New message sent to chat ${chatId}`);
        }
    } catch (error) {
        if (!error.message.includes('not modified') && !error.message.includes('Bad Request: message is not modified')) {
            console.warn('[SEND]'.yellow + ' Gagal mengirim pesan:', error.message);
            try {
                const chatId = msg.chat?.id || msg.from?.id;
                if (chatId) {
                    await bot.sendMessage(chatId, text, {
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true,
                        reply_markup: keyboard
                    });
                    console.log(`[SEND FALLBACK]`.green + ` Fallback message sent to chat ${chatId}`);
                }
            } catch (fallbackError) {
                console.error('[SEND FALLBACK]'.red + ' Gagal total:', fallbackError.message);
                throw fallbackError;
            }
        }
    }
}

// Authentication and menu functions
async function isAdmin(userId) {
    return config.ADMIN_IDS.includes(userId);
}

async function subscriptionGate(msg, userId) {
    // Admin always has access
    if (await isAdmin(userId)) {
        console.log(`[SUBSCRIPTION GATE]`.green + ` Admin ${userId} granted access`);
        return true;
    }

    try {
        const isSubscribed = await database.isUserSubscribed(userId);
        console.log(`[SUBSCRIPTION GATE]`.cyan + ` User ${userId} subscription status: ${isSubscribed}`);
        
        if (!isSubscribed) {
            if (msg.message_id) {
                bot.answerCallbackQuery(msg.id, {
                    text: "❌ Fitur ini hanya untuk pelanggan aktif.",
                    show_alert: true
                }).catch(() => {});
            } else {
                bot.sendMessage(msg.chat.id, "❌ Fitur ini hanya untuk pelanggan aktif.").catch(() => {});
            }
            return false;
        }
        return true;
    } catch (error) {
        console.error('[SUBSCRIPTION]'.red + ' Error checking subscription:', error.message);
        // If admin, grant access even on error
        if (await isAdmin(userId)) return true;
        return false;
    }
}

async function showRegistrationMenu(msg) {
    try {
        const keyboard = {
            inline_keyboard: [
                [{ text: "✍️ Daftar & Lanjutkan", callback_data: 'register_now' }]
            ]
        };

        const text = `👋 *Selamat Datang di Bot Jaseb!*\n\nUntuk menggunakan bot, Anda perlu mendaftarkan diri. Proses ini hanya sekali dan data Anda akan aman bersama kami.`;

        await sendOrEdit(msg, text, keyboard);
        console.log(`[MENU]`.cyan + ` Registration menu shown to user ${msg.from?.id}`);
    } catch (error) {
        console.error('[REGISTRATION MENU]'.red + ' Error:', error.message);
        throw error;
    }
}

async function showAdminMenu(msg) {
    try {
        const userName = msg.from?.first_name || 'Admin';
        
        // Get system stats with safe error handling
        let totalUsers = 0;
        let activeSubscriptions = 0;
        let activeUserbots = 0;
        
        try {
            totalUsers = await new Promise((resolve) => {
                database.db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
                    resolve(err ? 0 : (row ? row.count : 0));
                });
            });
        } catch (e) { console.error('Error getting user count:', e.message); }
        
        try {
            activeSubscriptions = await new Promise((resolve) => {
                database.db.get("SELECT COUNT(*) as count FROM subscriptions WHERE end_date > ?", 
                    [database.getCurrentTimestamp()], (err, row) => {
                        resolve(err ? 0 : (row ? row.count : 0));
                    });
            });
        } catch (e) { console.error('Error getting subscription count:', e.message); }
        
        try {
            activeUserbots = await new Promise((resolve) => {
                database.db.get("SELECT COUNT(*) as count FROM userbots WHERE status = 'active' AND userbot_id IS NOT NULL", 
                    (err, row) => {
                        resolve(err ? 0 : (row ? row.count : 0));
                    });
            });
        } catch (e) { console.error('Error getting userbot count:', e.message); }

        const text = `👑 *Panel Administrator*\n\nSelamat datang, ${escapeMarkdown(userName)}!\n\n` +
                     `📊 **Statistik Sistem:**\n` +
                     `👤 Total Pengguna: \`${totalUsers}\`\n` +
                     `⭐ Pelanggan Aktif: \`${activeSubscriptions}\`\n` +
                     `🤖 Userbot Aktif: \`${activeUserbots}\`\n\n` +
                     `⚡ *Status:* Sistem Operasional`;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: "➕ Tambah Langganan", callback_data: 'admin_extend_sub' },
                    { text: "🤖 Tambah Userbot", callback_data: 'admin_add_userbot' }
                ],
                [{ text: "👥 List Pelanggan", callback_data: 'admin_list_customers' }],
                [
                    { text: "🎁 Buat Kode Redeem", callback_data: 'admin_redeem' },
                    { text: "📢 Broadcast", callback_data: 'admin_broadcast' }
                ],
                [{ text: "⚙️ Atur Promo Default", callback_data: 'admin_promo' }],
                [{ text: "🕶️ Masuk Mode Pelanggan", callback_data: 'admin_as_customer' }]
            ]
        };

        await sendOrEdit(msg, text, keyboard);
        console.log(`[ADMIN MENU]`.green + ` Successfully displayed - Users: ${totalUsers}, Subs: ${activeSubscriptions}, Bots: ${activeUserbots}`);
        
    } catch (error) {
        console.error('[ADMIN MENU]'.red + ' Error:', error.message);
        try {
            const errorText = "❌ Terjadi kesalahan saat memuat menu admin.\n\nSilakan coba lagi.";
            if (msg.message_id) {
                await bot.editMessageText(errorText, {
                    chat_id: msg.chat.id,
                    message_id: msg.message_id,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🔄 Coba Lagi", callback_data: 'back_to_admin' }]
                        ]
                    }
                });
            } else {
                await bot.sendMessage(msg.chat.id, errorText, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🔄 Coba Lagi", callback_data: 'back_to_admin' }]
                        ]
                    }
                });
            }
        } catch (sendError) {
            console.error('[ADMIN MENU]'.red + ' Failed to send error message:', sendError.message);
        }
    }
}

async function refreshUserbotStatus(userId) {
    try {
        const userbots = await database.getUserbotsByOwner(userId);
        userbotStatusCache.set(userId, {
            userbots: userbots,
            lastUpdate: Date.now()
        });
        console.log(`[REFRESH]`.green + ` Updated userbot status for user ${userId}: ${userbots.length} bots`);
        return userbots;
    } catch (error) {
        console.error('[REFRESH STATUS]'.red + ' Error:', error.message);
        return [];
    }
}

async function showCustomerMenu(msg) {
    try {
        const userId = msg.from.id;

        // Clear conversation states but preserve admin detection
        userStates.delete(userId);
        
        // ENHANCED: Get correct admin detection with better logic
        const directAdminStatus = await isAdmin(userId);
        const userDataObj = userData.get(userId) || {};
        const isAdminInCustomerMode = userDataObj.is_admin_in_customer_mode || false;
        const finalAdminStatus = directAdminStatus || isAdminInCustomerMode;
        
        console.log(`[CUSTOMER MENU ADMIN CHECK]`.green + ` User ${userId} - Direct admin: ${directAdminStatus}, Customer mode admin: ${isAdminInCustomerMode}, Final admin: ${finalAdminStatus}`);
        
        // Ensure msg.from.id is always the correct user ID
        if (!msg.from) msg.from = {};
        msg.from.id = userId;
        
        let userbots = [];
        
        console.log(`[CUSTOMER MENU]`.cyan + ` User ${userId} (Admin: ${finalAdminStatus}) requesting userbot data...`);
        
        try {
            // COMPLETELY FIXED: Enhanced database query with better validation
            userbots = await new Promise((resolve, reject) => {
                let query, params;
                
                if (finalAdminStatus) {
                    // ADMIN: Show ALL active userbots with real telegram data
                    query = `
                        SELECT userbot_id, userbot_name, status, is_running_worker, owner_id, session_string 
                        FROM userbots 
                        WHERE status = 'active' 
                        AND userbot_id IS NOT NULL 
                        AND userbot_name IS NOT NULL 
                        AND userbot_name != '' 
                        AND CAST(userbot_id AS TEXT) NOT LIKE 'UserBot_%'
                        ORDER BY owner_id ASC
                    `;
                    params = [];
                    console.log(`[ADMIN QUERY]`.green + ` Admin ${userId} getting ALL system userbots with real data`);
                } else {
                    // REGULAR USER: Show only owned userbots with real telegram data
                    query = `
                        SELECT userbot_id, userbot_name, status, is_running_worker, owner_id, session_string 
                        FROM userbots 
                        WHERE owner_id = ? 
                        AND status = 'active' 
                        AND userbot_id IS NOT NULL 
                        AND userbot_name IS NOT NULL 
                        AND userbot_name != '' 
                        AND CAST(userbot_id AS TEXT) NOT LIKE 'UserBot_%'
                        ORDER BY userbot_name ASC
                    `;
                    params = [userId];
                    console.log(`[USER QUERY]`.cyan + ` User ${userId} getting owned userbots with real data`);
                }
                
                console.log(`[DB QUERY]`.yellow + ` SQL: ${query.replace(/\s+/g, ' ').trim()}`);
                console.log(`[DB PARAMS]`.yellow + ` Params: ${JSON.stringify(params)}`);
                
                database.db.all(query, params, (err, rows) => {
                    if (err) {
                        console.error(`[DB ERROR]`.red + ` Query failed:`, err);
                        reject(err);
                    } else {
                        console.log(`[DB SUCCESS]`.green + ` Query returned ${rows ? rows.length : 0} rows`);
                        resolve(rows || []);
                    }
                });
            });
            
            console.log(`[CUSTOMER MENU DB RESULT]`.green + ` Direct query returned ${userbots.length} userbots for user ${userId}`);
            
            // Enhanced validation with better filtering
            const validUserbots = userbots.filter(userbot => {
                const hasValidId = userbot.userbot_id && typeof userbot.userbot_id === 'number' && userbot.userbot_id > 0;
                const hasValidName = userbot.userbot_name && typeof userbot.userbot_name === 'string' && userbot.userbot_name.trim() !== '';
                const isNotDummyData = !userbot.userbot_name.includes('UserBot_') && !userbot.userbot_name.includes('Bot-');
                const isActive = userbot.status === 'active';
                
                const isValid = hasValidId && hasValidName && isNotDummyData && isActive;
                
                if (!isValid) {
                    console.log(`[INVALID USERBOT]`.red + ` Skipping invalid: ID:${userbot.userbot_id}, Name:${userbot.userbot_name}, Status:${userbot.status}`);
                } else {
                    console.log(`[VALID USERBOT]`.green + ` Valid: ${userbot.userbot_id} (${userbot.userbot_name}) owner:${userbot.owner_id}`);
                }
                return isValid;
            });
            
            userbots = validUserbots;
            console.log(`[CUSTOMER MENU FINAL]`.green + ` Final valid userbots count: ${userbots.length}`);
            
        } catch (dbError) {
            console.error('[CUSTOMER MENU DB ERROR]'.red + ' Database error:', dbError.message);
            userbots = [];
        }
        
        // FIXED: Admin ALWAYS has active subscription
        const isSubscribed = finalAdminStatus ? true : await database.isUserSubscribed(userId);
        const expiryDate = finalAdminStatus ? "Admin (Unlimited)" : await database.getSubscriptionEndDate(userId);

        const statusText = isSubscribed ? "🟢 *Aktif*" : "🔴 *Tidak Aktif*";
        let text;

        // FIXED: Use final admin status
        if (finalAdminStatus) {
            text = `👑 *Panel Administrator (Mode Pelanggan)*\n\nStatus: ${statusText}\nBerakhir Pada: \`${expiryDate}\`\n\n`;
        } else {
            text = `👤 *Dashboard Pelanggan*\n\nStatus Langganan: ${statusText}\nBerakhir Pada: \`${expiryDate}\`\n\n`;
        }

        console.log(`[CUSTOMER MENU RESULT]`.green + ` User ${userId} (Admin: ${finalAdminStatus}) - FINAL RESULT: ${userbots.length} userbots found`);
        
        // DETAILED DEBUG OUTPUT
        if (userbots.length > 0) {
            console.log(`[CUSTOMER MENU DETAILS]`.cyan + ` Listing all found userbots:`);
            userbots.forEach((ub, index) => {
                console.log(`[CUSTOMER MENU DETAILS]`.cyan + ` ${index + 1}. ID: ${ub.userbot_id}, Name: ${ub.userbot_name}, Owner: ${ub.owner_id}, Status: ${ub.status}`);
            });
        } else {
            console.log(`[CUSTOMER MENU WARNING]`.yellow + ` NO USERBOTS FOUND for user ${userId} (admin: ${finalAdminStatus})`);
        }

        if (userbots.length === 0) {
            text += "❌ *Belum memiliki userbot aktif.*\n\n";
            if (finalAdminStatus) {
                text += "➕ Gunakan menu admin untuk menambahkan userbot atau periksa database.\n\n";
                text += "🔍 *Debug Info:* Jika userbot sudah ditambahkan, periksa status di database.\n\n";
            } else {
                text += "📞 Hubungi admin untuk menambahkan userbot Anda.\n\n";
            }
        } else {
            text += `🤖 *Userbot Tersedia (${userbots.length}):*\n\n`;

            // Show userbot dengan status real-time yang lebih akurat
            for (const userbot of userbots) {
                try {
                    const config = await database.getJasebConfig(userbot.userbot_id);
                    const isRunning = config && config.running;
                    const isWorking = userbot.is_running_worker;
                    
                    let statusIcon, realStatus;
                    
                    if (userbot.status && userbot.status.startsWith('error:')) {
                        statusIcon = "❌";
                        realStatus = "*Error*";
                    } else if (isWorking) {
                        statusIcon = "🔄";
                        realStatus = "*Sedang Bekerja*";
                    } else if (isRunning) {
                        statusIcon = "▶️";
                        realStatus = "*Siap Bekerja*";
                    } else {
                        statusIcon = "⏹️";
                        realStatus = "*Standby*";
                    }
                    
                    const botName = userbot.userbot_name || `Bot-${userbot.userbot_id}`;
                    const ownerInfo = finalAdminStatus && userbot.owner_id !== userId ? ` (Owner: ${userbot.owner_id})` : '';
                    
                    text += `${statusIcon} *${escapeMarkdown(botName)}*${ownerInfo}\n`;
                    text += `   └ Status: ${realStatus}\n`;
                    text += `   └ ID: \`${userbot.userbot_id}\`\n\n`;
                    
                    console.log(`[CUSTOMER MENU USERBOT]`.green + ` Displayed userbot: ${botName} (${userbot.userbot_id}) - Status: ${realStatus}`);
                    
                } catch (configError) {
                    console.error('[CUSTOMER MENU CONFIG]'.red + ' Config error for userbot:', configError.message);
                    const botName = userbot.userbot_name || `Bot-${userbot.userbot_id}`;
                    text += `⚠️ *${escapeMarkdown(botName)}* - *Status Unknown*\n\n`;
                }
            }

            text += `🎛️ **Kontrol Userbot:**`;
        }

        // Simplified keyboard - hanya satu jenis submenu yang clean
        const keyboard = { inline_keyboard: [] };

        // Userbot control buttons - hanya jika ada userbot dan berlangganan
        if (userbots.length > 0 && isSubscribed) {
            // Batasi maksimal 6 userbot per baris untuk tampilan yang rapi
            for (let i = 0; i < userbots.length; i += 1) {
                const botName = userbots[i].userbot_name || `Bot-${userbots[i].userbot_id}`;
                // Singkat nama jika terlalu panjang
                const shortName = botName.length > 15 ? botName.substring(0, 12) + '...' : botName;
                keyboard.inline_keyboard.push([
                    { text: `🎛️ Kontrol ${shortName}`, callback_data: `control_ubot_${userbots[i].userbot_id}` }
                ]);
            }
            
            // Tambahkan refresh button untuk update real-time
            keyboard.inline_keyboard.push([
                { text: "🔄 Refresh Status Userbot", callback_data: "refresh_userbot_status" }
            ]);
        }

        // Options menu - simplified
        const optionsRow = [];
        if (!userbots.length || !isSubscribed) {
            optionsRow.push({ text: "🎁 Redeem Code", callback_data: "redeem_code_start" });
        }
        optionsRow.push({ text: "💳 Info & Bantuan", callback_data: 'customer_renew_info' });
        
        if (optionsRow.length > 0) {
            keyboard.inline_keyboard.push(optionsRow);
        }

        // FIXED: Admin navigation - tetap ada tapi simplified
        if (finalAdminStatus) {
            keyboard.inline_keyboard.push([{ text: "👑 Menu Admin", callback_data: 'back_to_admin' }]);
        }

        await sendOrEdit(msg, text, keyboard);
        console.log(`[CUSTOMER MENU]`.green + ` Clean menu displayed for user ${userId} - ${userbots.length} bots detected`);
        
    } catch (error) {
        console.error('[CUSTOMER MENU]'.red + ' Fatal error:', error.message);
        
        try {
            const safeErrorMsg = `❌ Sistem error. Gunakan /start untuk restart.`;
            
            if (msg.message_id && msg.chat) {
                await bot.editMessageText(safeErrorMsg, {
                    chat_id: msg.chat.id,
                    message_id: msg.message_id,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🔄 Restart", callback_data: 'restart_bot' }]
                        ]
                    }
                });
            } else {
                const chatId = msg.chat?.id || msg.from?.id;
                if (chatId) {
                    await bot.sendMessage(chatId, safeErrorMsg, {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "🔄 Restart", callback_data: 'restart_bot' }]
                            ]
                        }
                    });
                }
            }
        } catch (sendError) {
            console.error('[CUSTOMER MENU]'.red + ' Failed to send error message:', sendError.message);
        }
    }
}

async function showUserbotControlPanel(msg, successText = null) {
    try {
        const userId = msg.from.id;
        let userbotId = null;

        // Extract userbot ID from callback data or user data
        if (msg.data && msg.data.startsWith('control_ubot_')) {
            userbotId = parseInt(msg.data.split('_')[2]);
            let userDataObj = userData.get(userId) || {};
            userDataObj.selected_userbot_id = userbotId;
            userData.set(userId, userDataObj);
            console.log(`[USERBOT CONTROL]`.cyan + ` Selected userbot ${userbotId} for user ${userId}`);
        } else {
            const userDataObj = userData.get(userId) || {};
            userbotId = userDataObj.selected_userbot_id;
        }

        if (!userbotId) {
            console.error('[USERBOT CONTROL]'.red + ` No userbot ID found for user ${userId}`);
            const text = "❌ Terjadi kesalahan dalam memilih userbot.\n\nSilakan kembali ke menu pelanggan.";
            const keyboard = {
                inline_keyboard: [[{ text: "⬅️ Kembali ke Menu Pelanggan", callback_data: "back_to_customer" }]]
            };
            await sendOrEdit(msg, text, keyboard);
            return;
        }

        // COMPLETELY FIXED: Verify userbot access with PROPER admin privileges
        let userbot = null;
        
        // Enhanced admin detection with proper context preservation
        const userDataObj = userData.get(userId) || {};
        const directAdminStatus = await isAdmin(userId);
        const isAdminInCustomerMode = userDataObj.is_admin_in_customer_mode || false;
        const isAdminMode = directAdminStatus || isAdminInCustomerMode;
        
        console.log(`[USERBOT ACCESS DEBUG]`.cyan + ` User ${userId} - Direct admin: ${directAdminStatus}, Customer mode: ${isAdminInCustomerMode}, Final admin: ${isAdminMode}`);
        
        try {
            if (isAdminMode) {
                // ADMIN: Can access ANY active userbot in the system (include real telegram data check)
                userbot = await new Promise((resolve, reject) => {
                    database.db.get(`
                        SELECT userbot_id, userbot_name, owner_id, status, is_running_worker 
                        FROM userbots 
                        WHERE userbot_id = ? 
                        AND status = 'active'
                        AND CAST(userbot_id AS TEXT) NOT LIKE 'UserBot_%'
                    `, [userbotId], (err, row) => {
                        if (err) {
                            console.error(`[ADMIN USERBOT ACCESS]`.red + ` Database error:`, err);
                            reject(err);
                        } else {
                            if (row) {
                                console.log(`[ADMIN ACCESS]`.green + ` Admin ${userId} accessing userbot ${userbotId} (owner: ${row.owner_id})`);
                            } else {
                                console.log(`[ADMIN ACCESS]`.yellow + ` Admin ${userId} - userbot ${userbotId} not found or inactive`);
                            }
                            resolve(row);
                        }
                    });
                });
            } else {
                // Regular user can only access their own userbots (include real telegram data check)
                userbot = await new Promise((resolve, reject) => {
                    database.db.get(`
                        SELECT userbot_id, userbot_name, status, is_running_worker 
                        FROM userbots 
                        WHERE owner_id = ? 
                        AND userbot_id = ? 
                        AND status = 'active'
                        AND CAST(userbot_id AS TEXT) NOT LIKE 'UserBot_%'
                    `, [userId, userbotId], (err, row) => {
                        if (err) {
                            console.error(`[USER USERBOT ACCESS]`.red + ` Database error:`, err);
                            reject(err);
                        } else {
                            if (row) {
                                console.log(`[USER ACCESS]`.cyan + ` User ${userId} accessing own userbot ${userbotId}`);
                            } else {
                                console.log(`[USER ACCESS]`.yellow + ` User ${userId} - userbot ${userbotId} not found, not owned, or inactive`);
                            }
                            resolve(row);
                        }
                    });
                });
            }
        } catch (dbError) {
            console.error('[USERBOT CONTROL DB]'.red + ' Database error:', dbError.message);
            userbot = null;
        }

        if (!userbot) {
            console.error('[USERBOT CONTROL]'.red + ` Userbot ${userbotId} not found or no access for user ${userId}`);
            const text = "❌ Userbot tidak ditemukan atau Anda tidak memiliki akses.\n\nSilakan kembali ke menu pelanggan.";
            const keyboard = {
                inline_keyboard: [[{ text: "⬅️ Kembali ke Menu Pelanggan", callback_data: "back_to_customer" }]]
            };
            await sendOrEdit(msg, text, keyboard);
            return;
        }

        const userbotName = userbot.userbot_name || `Bot-${userbotId}`;

        // Get configuration data with safe error handling
        let configData = null;
        let autoChatConfig = null;
        let autoJoinConfig = null;
        
        try {
            configData = await database.getJasebConfig(userbotId);
        } catch (e) { console.error('Error getting jaseb config:', e.message); }
        
        try {
            autoChatConfig = await database.getAutoChatConfig(userbotId);
        } catch (e) { console.error('Error getting auto chat config:', e.message); }
        
        try {
            autoJoinConfig = await database.getAutoJoinConfig(userbotId);
        } catch (e) { console.error('Error getting auto join config:', e.message); }

        const isWorking = userbot.is_running_worker;
        const userbotStatus = userbot.status;
        const isRunning = configData && configData.running;
        const hasMessage = configData && configData.type;
        const autoChatActive = autoChatConfig && autoChatConfig.auto_chat_status;
        const autoJoinActive = autoJoinConfig && autoJoinConfig.auto_join_status;

        let statusBot;
        if (userbotStatus && userbotStatus.startsWith('error:')) {
            statusBot = "❌ *Error*";
        } else if (isWorking) {
            statusBot = "🔄 *Sedang Bekerja*";
        } else if (isRunning) {
            statusBot = "▶️ *Siap Bekerja*";
        } else {
            statusBot = "⏹️ *Berhenti*";
        }
        
        const toggleText = isRunning ? "⏹️ Hentikan Sebar" : "▶️ Mulai Sebar";

        let text = "";
        if (successText) {
            text += `✅ _${successText}_\n\n`;
        }

        text += `🎛️ *Panel Kontrol ${escapeMarkdown(userbotName)}*\n\n`;
        text += `📊 **Status Real-Time:**\n`;
        text += `• Status Sebar: ${statusBot}\n`;
        text += `• Status Userbot: ${userbotStatus === 'active' ? '🟢 Online' : '🟡 Pending'}\n`;
        text += `• Pesan Tersimpan: ${hasMessage ? '✅ Ya' : '❌ Belum'}\n`;
        text += `• Jeda Sebar: ${configData ? configData.delay + ' detik' : '20 detik (default)'}\n`;
        text += `• Auto Chat Member: ${autoChatActive ? '🟢 Aktif' : '🔴 Nonaktif'}\n`;
        text += `• Auto Join Group: ${autoJoinActive ? '🟢 Aktif' : '🔴 Nonaktif'}\n\n`;
        text += `🎛️ **Pilih fitur yang ingin diatur:**`;

        const keyboard = {
            inline_keyboard: [
                [{ text: toggleText, callback_data: `toggle_${userbotId}` }],
                [
                    { text: "📝 Atur Pesan Sebar", callback_data: `set_msg_${userbotId}` },
                    { text: "⏱️ Atur Jeda Sebar", callback_data: `set_delay_${userbotId}` }
                ],
                [
                    { text: "👥 Auto Chat Member", callback_data: `auto_chat_menu_${userbotId}` },
                    { text: "🔗 Auto Join Group", callback_data: `auto_join_menu_${userbotId}` }
                ],
                [
                    { text: "💬 Auto-Reply PM", callback_data: `pm_reply_menu_${userbotId}` },
                    { text: "📣 Auto-Reply Grup", callback_data: `promo_menu_${userbotId}` }
                ],
                [{ text: "📊 Lihat Log Aktivitas", callback_data: `view_log_${userbotId}` }],
                [{ text: "⬅️ Daftar Userbot", callback_data: "back_to_customer" }]
            ]
        };

        await sendOrEdit(msg, text, keyboard);
        console.log(`[USERBOT CONTROL]`.green + ` Successfully displayed control panel for userbot ${userbotId}`);
        
    } catch (error) {
        console.error('[USERBOT CONTROL]'.red + ' Fatal error:', error.message);

        try {
            const text = "❌ Terjadi kesalahan saat memuat panel kontrol userbot.\n\nSilakan kembali ke menu pelanggan.";
            const keyboard = {
                inline_keyboard: [[{ text: "⬅️ Kembali ke Menu Pelanggan", callback_data: "back_to_customer" }]]
            };
            await sendOrEdit(msg, text, keyboard);
        } catch (sendError) {
            console.error('[USERBOT CONTROL]'.red + ' Failed to send error message:', sendError.message);
        }
    }
}

// Start polling with retry mechanism
async function startPolling() {
    if (isPolling) return;

    try {
        console.log('[BOT]'.green + ' Memulai polling...');

        await bot.startPolling({
            restart: true,
            polling: {
                interval: 2000,
                autoStart: false,
                params: {
                    timeout: 30,
                    allowed_updates: ['message', 'callback_query']
                }
            }
        });

        isPolling = true;
        console.log('[BOT]'.green + ' Bot berhasil memulai polling.');

    } catch (error) {
        console.error('[BOT ERROR]'.red + ' Gagal memulai polling:', error.message);
        isPolling = false;

        setTimeout(() => {
            console.log('[BOT]'.yellow + ' Mencoba restart polling...');
            startPolling();
        }, 5000);
    }
}

// Auto-refresh userbot status setiap 30 detik
setInterval(async () => {
    try {
        // Clear old cache (older than 5 minutes)
        const now = Date.now();
        for (const [userId, cache] of userbotStatusCache) {
            if (now - cache.lastUpdate > 5 * 60 * 1000) {
                userbotStatusCache.delete(userId);
            }
        }
        
        // Auto-refresh status for active users
        for (const [userId, cache] of userbotStatusCache) {
            if (now - cache.lastUpdate > 30 * 1000) { // Refresh every 30 seconds
                await refreshUserbotStatus(userId);
            }
        }
    } catch (error) {
        // Ignore errors in background task
    }
}, 30000);

// Debug command untuk admin
bot.onText(/\/debug/, async (msg) => {
    try {
        const userId = msg.from.id;
        
        if (!(await isAdmin(userId))) {
            await bot.sendMessage(msg.chat.id, "❌ Command ini hanya untuk admin.");
            return;
        }

        let debugText = "🔍 *DEBUG USERBOT STATUS*\n\n";
        
        // Check all userbots in database
        const allUserbots = await new Promise((resolve) => {
            database.db.all("SELECT * FROM userbots ORDER BY id ASC", (err, rows) => {
                resolve(err ? [] : (rows || []));
            });
        });
        
        debugText += `📊 **Total Records in Database:** ${allUserbots.length}\n\n`;
        
        for (const ub of allUserbots) {
            debugText += `🤖 **Userbot ID ${ub.id}:**\n`;
            debugText += `• Owner: \`${ub.owner_id}\`\n`;
            debugText += `• Userbot ID: \`${ub.userbot_id || 'NULL'}\`\n`;
            debugText += `• Name: \`${ub.userbot_name || 'NULL'}\`\n`;
            debugText += `• Status: \`${ub.status}\`\n`;
            debugText += `• Worker: \`${ub.is_running_worker ? 'YES' : 'NO'}\`\n\n`;
        }
        
        // Check active userbots specifically
        const activeUserbots = await new Promise((resolve) => {
            database.db.all(`
                SELECT userbot_id, userbot_name, status, owner_id 
                FROM userbots 
                WHERE status = 'active' 
                AND userbot_id IS NOT NULL 
                AND userbot_name IS NOT NULL
            `, (err, rows) => {
                resolve(err ? [] : (rows || []));
            });
        });
        
        debugText += `✅ **Active Userbots:** ${activeUserbots.length}\n\n`;
        
        for (const ub of activeUserbots) {
            debugText += `• ID: \`${ub.userbot_id}\` Name: \`${ub.userbot_name}\` Owner: \`${ub.owner_id}\`\n`;
        }
        
        await bot.sendMessage(msg.chat.id, debugText, { parse_mode: 'Markdown' });
        
    } catch (error) {
        console.error('[DEBUG COMMAND]'.red + ' Error:', error.message);
        await bot.sendMessage(msg.chat.id, `❌ Debug error: ${error.message}`);
    }
});

// Bot command handlers
bot.onText(/\/start/, async (msg) => {
    try {
        const userId = msg.from.id;
        const firstName = msg.from.first_name || 'User';
        const username = msg.from.username || null;

        console.log(`[START]`.cyan + ` Command received from user ${userId} (${firstName})`);

        // Always add/update user first
        await database.addUser(userId, firstName, username);

        if (await isAdmin(userId)) {
            console.log(`[START]`.cyan + ` Admin user detected: ${userId}`);
            await showAdminMenu(msg);
            return;
        }

        const isRegistered = await database.isUserRegistered(userId);
        console.log(`[START]`.cyan + ` User ${userId} registration status: ${isRegistered}`);

        if (!isRegistered) {
            await showRegistrationMenu(msg);
            return;
        }

        await showCustomerMenu(msg);
    } catch (error) {
        console.error('[START COMMAND]'.red + ' Error:', error.message);
        console.error('[START COMMAND]'.red + ' Stack:', error.stack);
        try {
            await bot.sendMessage(msg.chat.id, "❌ Terjadi kesalahan sistem. Silakan coba lagi dalam beberapa saat.");
        } catch (sendError) {
            console.error('[START COMMAND]'.red + ' Failed to send error message:', sendError.message);
        }
    }
});

// Message handler for conversation states
bot.on('message', async (msg) => {
    try {
        const userId = msg.from.id;
        const state = userStates.get(userId);
        
        if (!state || msg.text?.startsWith('/')) return;

        console.log(`[MESSAGE]`.cyan + ` Processing state ${state} for user ${userId}`);
        
        const userDataObj = userData.get(userId) || {};

        switch (state) {
            case ConversationStates.GET_EXTEND_ID:
                if (!(await isAdmin(userId))) return;
                const targetId = parseInt(msg.text);
                if (isNaN(targetId)) {
                    await bot.sendMessage(msg.chat.id, "❌ ID harus berupa angka.");
                    return;
                }
                userDataObj.extend_target_id = targetId;
                userData.set(userId, userDataObj);
                userStates.set(userId, ConversationStates.GET_EXTEND_DURATION);
                await bot.sendMessage(msg.chat.id, "Masukkan durasi (hari):");
                break;

            case ConversationStates.GET_EXTEND_DURATION:
                if (!(await isAdmin(userId))) return;
                const duration = parseInt(msg.text);
                if (isNaN(duration) || duration <= 0) {
                    await bot.sendMessage(msg.chat.id, "❌ Durasi harus berupa angka positif.");
                    return;
                }
                try {
                    await database.addSubscription(userDataObj.extend_target_id, duration);
                    await bot.sendMessage(msg.chat.id, `✅ Langganan untuk user ${userDataObj.extend_target_id} berhasil diperpanjang ${duration} hari.`);
                    userStates.delete(userId);
                    userData.delete(userId);
                    
                    // Show admin menu again
                    setTimeout(() => showAdminMenu(msg), 1000);
                } catch (error) {
                    await bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
                }
                break;

            case ConversationStates.GET_OWNER_ID_FOR_USERBOT:
                if (!(await isAdmin(userId))) return;
                const ownerId = parseInt(msg.text);
                if (isNaN(ownerId)) {
                    await bot.sendMessage(msg.chat.id, "❌ ID harus berupa angka.");
                    return;
                }
                userDataObj.userbot_owner_id = ownerId;
                userData.set(userId, userDataObj);
                userStates.set(userId, ConversationStates.GET_SESSION_STRING);
                await bot.sendMessage(msg.chat.id, "Masukkan session string userbot:");
                break;

            case ConversationStates.GET_SESSION_STRING:
                if (!(await isAdmin(userId))) return;
                try {
                    const success = await database.addUserbotSession(userDataObj.userbot_owner_id, msg.text);
                    if (success) {
                        await bot.sendMessage(msg.chat.id, "✅ Session string berhasil ditambahkan. Userbot akan diaktivasi secara otomatis.");
                        logToChannel('INFO', 'Userbot Baru Ditambahkan', 
                            `Admin menambahkan userbot baru untuk owner \`${userDataObj.userbot_owner_id}\`.`);
                    } else {
                        await bot.sendMessage(msg.chat.id, "❌ Session string sudah ada atau tidak valid.");
                    }
                    userStates.delete(userId);
                    userData.delete(userId);
                    
                    // Show admin menu again
                    setTimeout(() => showAdminMenu(msg), 1000);
                } catch (error) {
                    await bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
                }
                break;

            case ConversationStates.GET_JASEB_MESSAGE:
                if (!(await subscriptionGate(msg, userId))) return;
                const userbotId = userDataObj.selected_userbot_id;
                if (!userbotId) {
                    await bot.sendMessage(msg.chat.id, "❌ Tidak ada userbot yang dipilih.");
                    userStates.delete(userId);
                    return;
                }

                try {
                    let messageType, text, fileId, entities;
                    
                    if (msg.photo) {
                        messageType = 'photo';
                        fileId = msg.photo[msg.photo.length - 1].file_id;
                        text = msg.caption || '';
                        entities = msg.caption_entities || null;
                    } else if (msg.video) {
                        messageType = 'video';
                        fileId = msg.video.file_id;
                        text = msg.caption || '';
                        entities = msg.caption_entities || null;
                    } else if (msg.text) {
                        messageType = 'text';
                        text = msg.text;
                        fileId = null;
                        entities = msg.entities || null;
                    } else {
                        await bot.sendMessage(msg.chat.id, "❌ Format pesan tidak didukung. Kirim teks, foto, atau video.");
                        return;
                    }

                    await database.setJasebMessage(userbotId, messageType, text, fileId, entities);
                    await bot.sendMessage(msg.chat.id, "✅ Pesan sebar berhasil disimpan!");
                    
                    userStates.delete(userId);
                    
                    // Refresh control panel
                    setTimeout(() => showUserbotControlPanel(msg, "Pesan sebar berhasil diatur"), 1000);
                } catch (error) {
                    await bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
                }
                break;

            case ConversationStates.GET_JASEB_DELAY:
                if (!(await subscriptionGate(msg, userId))) return;
                const delayUserbotId = userDataObj.selected_userbot_id;
                if (!delayUserbotId) {
                    await bot.sendMessage(msg.chat.id, "❌ Tidak ada userbot yang dipilih.");
                    userStates.delete(userId);
                    return;
                }

                const delay = parseInt(msg.text);
                if (isNaN(delay) || delay < 10) {
                    await bot.sendMessage(msg.chat.id, "❌ Jeda minimal 10 detik.");
                    return;
                }

                try {
                    await database.setJasebDelay(delayUserbotId, delay);
                    await bot.sendMessage(msg.chat.id, `✅ Jeda sebar diatur ke ${delay} detik.`);
                    
                    userStates.delete(userId);
                    
                    // Refresh control panel
                    setTimeout(() => showUserbotControlPanel(msg, `Jeda sebar diatur ke ${delay} detik`), 1000);
                } catch (error) {
                    await bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
                }
                break;

            case ConversationStates.GET_REDEEM_CODE:
                const code = msg.text.trim();
                try {
                    const result = await database.redeemCode(code, userId);
                    if (result === "NOT_FOUND") {
                        await bot.sendMessage(msg.chat.id, "❌ Kode redeem tidak ditemukan atau tidak valid.");
                    } else if (result === "ALREADY_USED") {
                        await bot.sendMessage(msg.chat.id, "❌ Kode redeem sudah pernah digunakan.");
                    } else {
                        await bot.sendMessage(msg.chat.id, `✅ Kode redeem berhasil ditukar! Langganan diperpanjang ${result} hari.`);
                        logToChannel('SUCCESS', 'Kode Redeem Digunakan', 
                            `User \`${userId}\` berhasil menukar kode redeem untuk ${result} hari.`);
                    }
                    userStates.delete(userId);
                    
                    // Refresh customer menu
                    setTimeout(() => showCustomerMenu(msg), 1000);
                } catch (error) {
                    await bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
                }
                break;

            case ConversationStates.GET_PM_REPLY_TEXT:
                if (!(await subscriptionGate(msg, userId))) return;
                const pmUserbotId = userDataObj.selected_userbot_id;
                if (!pmUserbotId) {
                    await bot.sendMessage(msg.chat.id, "❌ Tidak ada userbot yang dipilih.");
                    userStates.delete(userId);
                    return;
                }

                try {
                    await database.setPmReplyText(pmUserbotId, msg.text);
                    await bot.sendMessage(msg.chat.id, "✅ Teks balasan PM berhasil diatur!");
                    
                    userStates.delete(userId);
                    
                    // Refresh PM reply menu
                    setTimeout(() => {
                        msg.data = `pm_reply_menu_${pmUserbotId}`;
                        const mockQuery = { data: msg.data, from: msg.from, message: msg };
                        bot.emit('callback_query', mockQuery);
                    }, 1000);
                } catch (error) {
                    await bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
                }
                break;

            case ConversationStates.GET_REDEEM_DURATION:
                if (!(await isAdmin(userId))) return;
                const redeemDuration = parseInt(msg.text);
                if (isNaN(redeemDuration) || redeemDuration <= 0) {
                    await bot.sendMessage(msg.chat.id, "❌ Durasi harus berupa angka positif.");
                    return;
                }

                try {
                    const redeemCode = 'JASEB-' + Math.random().toString(36).substr(2, 8).toUpperCase();
                    await database.saveRedeemCode(redeemCode, redeemDuration);
                    await bot.sendMessage(msg.chat.id, `✅ Kode redeem berhasil dibuat!\n\n🎁 **Kode:** \`${redeemCode}\`\n⏰ **Durasi:** ${redeemDuration} hari`, {
                        parse_mode: 'Markdown'
                    });
                    
                    userStates.delete(userId);
                    
                    // Show admin menu again
                    setTimeout(() => showAdminMenu(msg), 1000);
                } catch (error) {
                    await bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
                }
                break;

            case ConversationStates.GET_BROADCAST_MESSAGE:
                if (!(await isAdmin(userId))) return;
                try {
                    const userIds = await database.getAllUserIds();
                    let successCount = 0;
                    let failCount = 0;

                    await bot.sendMessage(msg.chat.id, `📢 Memulai broadcast ke ${userIds.length} pengguna...`);

                    for (const targetUserId of userIds) {
                        try {
                            if (msg.photo) {
                                await bot.sendPhoto(targetUserId, msg.photo[msg.photo.length - 1].file_id, {
                                    caption: msg.caption
                                });
                            } else if (msg.video) {
                                await bot.sendVideo(targetUserId, msg.video.file_id, {
                                    caption: msg.caption
                                });
                            } else {
                                await bot.sendMessage(targetUserId, msg.text);
                            }
                            successCount++;
                        } catch (error) {
                            failCount++;
                        }
                        
                        // Delay to avoid flood limits
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }

                    await bot.sendMessage(msg.chat.id, `✅ Broadcast selesai!\n\n📊 **Statistik:**\n• Berhasil: ${successCount}\n• Gagal: ${failCount}`, {
                        parse_mode: 'Markdown'
                    });
                    
                    userStates.delete(userId);
                    
                    // Show admin menu again
                    setTimeout(() => showAdminMenu(msg), 1000);
                } catch (error) {
                    await bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
                }
                break;

            case ConversationStates.GET_PROMO_KEYWORDS:
                if (!(await isAdmin(userId))) return;
                try {
                    await database.setDefaultPromoSettings(msg.text, null);
                    await bot.sendMessage(msg.chat.id, "✅ Kata kunci promo default berhasil diatur!");
                    
                    userStates.delete(userId);
                    
                    // Show admin menu again
                    setTimeout(() => showAdminMenu(msg), 1000);
                } catch (error) {
                    await bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
                }
                break;

            case ConversationStates.GET_PROMO_MESSAGE:
                if (!(await isAdmin(userId))) return;
                try {
                    await database.setDefaultPromoSettings(null, msg.text);
                    await bot.sendMessage(msg.chat.id, "✅ Pesan promo default berhasil diatur!");
                    
                    userStates.delete(userId);
                    
                    // Show admin menu again
                    setTimeout(() => showAdminMenu(msg), 1000);
                } catch (error) {
                    await bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
                }
                break;

            case ConversationStates.GET_PROMO_USERBOT_KEYWORDS:
                if (!(await subscriptionGate(msg, userId))) return;
                const promoUserbotId = userDataObj.selected_userbot_id;
                if (!promoUserbotId) {
                    await bot.sendMessage(msg.chat.id, "❌ Tidak ada userbot yang dipilih.");
                    userStates.delete(userId);
                    return;
                }

                try {
                    await database.setUserbotPromoConfig(promoUserbotId, null, msg.text, null);
                    await bot.sendMessage(msg.chat.id, "✅ Kata kunci promo berhasil diatur!");
                    
                    userStates.delete(userId);
                    
                    // Refresh promo menu
                    setTimeout(() => {
                        msg.data = `promo_menu_${promoUserbotId}`;
                        const mockQuery = { data: msg.data, from: msg.from, message: msg };
                        bot.emit('callback_query', mockQuery);
                    }, 1000);
                } catch (error) {
                    await bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
                }
                break;

            case ConversationStates.GET_PROMO_USERBOT_MESSAGE:
                if (!(await subscriptionGate(msg, userId))) return;
                const promoMsgUserbotId = userDataObj.selected_userbot_id;
                if (!promoMsgUserbotId) {
                    await bot.sendMessage(msg.chat.id, "❌ Tidak ada userbot yang dipilih.");
                    userStates.delete(userId);
                    return;
                }

                try {
                    await database.setUserbotPromoConfig(promoMsgUserbotId, null, null, msg.text);
                    await bot.sendMessage(msg.chat.id, "✅ Pesan promo berhasil diatur!");
                    
                    userStates.delete(userId);
                    
                    // Refresh promo menu
                    setTimeout(() => {
                        msg.data = `promo_menu_${promoMsgUserbotId}`;
                        const mockQuery = { data: msg.data, from: msg.from, message: msg };
                        bot.emit('callback_query', mockQuery);
                    }, 1000);
                } catch (error) {
                    await bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
                }
                break;

            case ConversationStates.GET_AUTO_CHAT_TARGET:
                if (!(await subscriptionGate(msg, userId))) return;
                const acUserbotId = userDataObj.selected_userbot_id;
                if (!acUserbotId) {
                    await bot.sendMessage(msg.chat.id, "❌ Tidak ada userbot yang dipilih.");
                    userStates.delete(userId);
                    return;
                }

                try {
                    await database.setAutoChatTarget(acUserbotId, msg.text);
                    await bot.sendMessage(msg.chat.id, "✅ Target grup auto chat berhasil diatur!");
                    
                    userStates.delete(userId);
                    
                    // Refresh auto chat menu
                    setTimeout(() => {
                        msg.data = `auto_chat_menu_${acUserbotId}`;
                        const mockQuery = { data: msg.data, from: msg.from, message: msg };
                        bot.emit('callback_query', mockQuery);
                    }, 1000);
                } catch (error) {
                    await bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
                }
                break;

            case ConversationStates.GET_AUTO_CHAT_DELAY:
                if (!(await subscriptionGate(msg, userId))) return;
                const acdUserbotId = userDataObj.selected_userbot_id;
                if (!acdUserbotId) {
                    await bot.sendMessage(msg.chat.id, "❌ Tidak ada userbot yang dipilih.");
                    userStates.delete(userId);
                    return;
                }

                const chatDelay = parseInt(msg.text);
                if (isNaN(chatDelay) || chatDelay < 30) {
                    await bot.sendMessage(msg.chat.id, "❌ Jeda minimal 30 detik untuk keamanan.");
                    return;
                }

                try {
                    await database.setAutoChatDelay(acdUserbotId, chatDelay);
                    await bot.sendMessage(msg.chat.id, `✅ Jeda auto chat diatur ke ${chatDelay} detik.`);
                    
                    userStates.delete(userId);
                    
                    // Refresh auto chat menu
                    setTimeout(() => {
                        msg.data = `auto_chat_menu_${acdUserbotId}`;
                        const mockQuery = { data: msg.data, from: msg.from, message: msg };
                        bot.emit('callback_query', mockQuery);
                    }, 1000);
                } catch (error) {
                    await bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
                }
                break;

            case ConversationStates.GET_AUTO_CHAT_MESSAGE:
                if (!(await subscriptionGate(msg, userId))) return;
                const acmUserbotId = userDataObj.selected_userbot_id;
                if (!acmUserbotId) {
                    await bot.sendMessage(msg.chat.id, "❌ Tidak ada userbot yang dipilih.");
                    userStates.delete(userId);
                    return;
                }

                try {
                    let messageType, text, fileId, entities;
                    
                    if (msg.photo) {
                        messageType = 'photo';
                        fileId = msg.photo[msg.photo.length - 1].file_id;
                        text = msg.caption || '';
                        entities = msg.caption_entities || null;
                    } else if (msg.video) {
                        messageType = 'video';
                        fileId = msg.video.file_id;
                        text = msg.caption || '';
                        entities = msg.caption_entities || null;
                    } else if (msg.text) {
                        messageType = 'text';
                        text = msg.text;
                        fileId = null;
                        entities = msg.entities || null;
                    } else {
                        await bot.sendMessage(msg.chat.id, "❌ Format pesan tidak didukung.");
                        return;
                    }

                    await database.setAutoChatMessage(acmUserbotId, messageType, text, fileId, entities);
                    await bot.sendMessage(msg.chat.id, "✅ Pesan auto chat berhasil diatur!");
                    
                    userStates.delete(userId);
                    
                    // Refresh auto chat menu
                    setTimeout(() => {
                        msg.data = `auto_chat_menu_${acmUserbotId}`;
                        const mockQuery = { data: msg.data, from: msg.from, message: msg };
                        bot.emit('callback_query', mockQuery);
                    }, 1000);
                } catch (error) {
                    await bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
                }
                break;

            case ConversationStates.GET_AUTO_JOIN_TARGET:
                if (!(await subscriptionGate(msg, userId))) return;
                const ajUserbotId = userDataObj.selected_userbot_id;
                if (!ajUserbotId) {
                    await bot.sendMessage(msg.chat.id, "❌ Tidak ada userbot yang dipilih.");
                    userStates.delete(userId);
                    return;
                }

                try {
                    await database.setAutoJoinTarget(ajUserbotId, msg.text);
                    await bot.sendMessage(msg.chat.id, "✅ Target grup auto join berhasil diatur!");
                    
                    userStates.delete(userId);
                    
                    // Refresh auto join menu
                    setTimeout(() => {
                        msg.data = `auto_join_menu_${ajUserbotId}`;
                        const mockQuery = { data: msg.data, from: msg.from, message: msg };
                        bot.emit('callback_query', mockQuery);
                    }, 1000);
                } catch (error) {
                    await bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
                }
                break;

            case ConversationStates.GET_AUTO_JOIN_DELAY:
                if (!(await subscriptionGate(msg, userId))) return;
                const ajdUserbotId = userDataObj.selected_userbot_id;
                if (!ajdUserbotId) {
                    await bot.sendMessage(msg.chat.id, "❌ Tidak ada userbot yang dipilih.");
                    userStates.delete(userId);
                    return;
                }

                const joinDelay = parseInt(msg.text);
                if (isNaN(joinDelay) || joinDelay < 60) {
                    await bot.sendMessage(msg.chat.id, "❌ Jeda minimal 60 detik untuk keamanan.");
                    return;
                }

                try {
                    await database.setAutoJoinDelay(ajdUserbotId, joinDelay);
                    await bot.sendMessage(msg.chat.id, `✅ Jeda auto join diatur ke ${joinDelay} detik.`);
                    
                    userStates.delete(userId);
                    
                    // Refresh auto join menu
                    setTimeout(() => {
                        msg.data = `auto_join_menu_${ajdUserbotId}`;
                        const mockQuery = { data: msg.data, from: msg.from, message: msg };
                        bot.emit('callback_query', mockQuery);
                    }, 1000);
                } catch (error) {
                    await bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
                }
                break;
        }
    } catch (error) {
        console.error('[MESSAGE HANDLER]'.red + ' Error:', error.message);
        await bot.sendMessage(msg.chat.id, "❌ Terjadi kesalahan. Silakan coba lagi.").catch(() => {});
        userStates.delete(msg.from.id);
    }
});

// Callback query handlers
bot.on('callback_query', async (query) => {
    try {
        const userId = query.from.id;
        const data = query.data;
        const msg = query.message;

        console.log(`[CALLBACK]`.cyan + ` Received: ${data} from user ${userId}`);

        await bot.answerCallbackQuery(query.id).catch(() => {});
        msg.data = data;

        if (data === 'register_now') {
            try {
                await database.addUser(userId, query.from.first_name || 'User', query.from.username);

                await bot.answerCallbackQuery(query.id, {
                    text: "✅ Pendaftaran Berhasil!",
                    show_alert: true
                }).catch(() => {});

                logToChannel('INFO', 'Pengguna Baru Mendaftar', 
                    `Pengguna baru telah mendaftar.\n- Nama: ${query.from.first_name || 'User'}\n- ID: \`${userId}\`\n- Username: @${query.from.username || 'None'}`);

                if (await isAdmin(userId)) {
                    await showAdminMenu(msg);
                } else {
                    await showCustomerMenu(msg);
                }
            } catch (error) {
                console.error('[REGISTER]'.red + ' Registration error:', error.message);
                await bot.answerCallbackQuery(query.id, {
                    text: "❌ Gagal mendaftar. Silakan coba lagi.",
                    show_alert: true
                }).catch(() => {});
            }
        }
        else if (data === 'back_to_admin') {
            await showAdminMenu(msg);
        }
        else if (data === 'back_to_customer') {
            await showCustomerMenu(msg);
        }
        else if (data === 'admin_as_customer') {
            // COMPLETELY FIXED: Proper admin preservation when switching to customer mode
            console.log(`[ADMIN AS CUSTOMER]`.yellow + ` Admin ${userId} switching to customer mode - preserving ALL admin privileges`);
            
            // Clear only non-essential data, preserve ALL admin context
            userbotStatusCache.delete(userId);
            userStates.delete(userId);
            
            // TRIPLE CONFIRM admin status before switching
            const adminBackup = await isAdmin(userId);
            console.log(`[ADMIN BACKUP CONFIRMATION]`.green + ` Admin status triple-confirmed: ${adminBackup} for user ${userId}`);
            
            if (!adminBackup) {
                console.error(`[ADMIN ERROR]`.red + ` User ${userId} is not actually an admin! Blocking customer mode switch.`);
                await bot.answerCallbackQuery(query.id, {
                    text: "❌ Akses ditolak - Anda bukan admin.",
                    show_alert: true
                }).catch(() => {});
                return;
            }
            
            // FORCE SET admin flags in userData for customer menu dengan ID yang BENAR
            let userDataObj = userData.get(userId) || {};
            userDataObj.is_admin_in_customer_mode = true;
            userDataObj.original_admin_id = userId;
            userDataObj.admin_confirmed = true;
            userDataObj.admin_timestamp = Date.now();
            userData.set(userId, userDataObj);
            
            console.log(`[ADMIN CONTEXT SET]`.green + ` Admin context fully preserved for user ${userId} with correct ID`);
            
            // CRITICAL FIX: Ensure correct message context
            const customerMsg = {
                ...msg,
                from: { id: userId, first_name: query.from.first_name || 'Admin' },
                chat: { id: msg.chat.id }
            };
            
            // Force database refresh before showing customer menu
            await new Promise(resolve => setTimeout(resolve, 100));
            
            await showCustomerMenu(customerMsg);
        }
        else if (data === 'restart_bot') {
            // Restart handler for error recovery
            await bot.answerCallbackQuery(query.id, {
                text: "🔄 Memulai ulang sistem...",
                show_alert: false
            }).catch(() => {});
            
            // Clear all user states and cache
            userStates.delete(userId);
            userData.delete(userId);
            userbotStatusCache.delete(userId);
            
            // Redirect to appropriate menu
            if (await isAdmin(userId)) {
                await showAdminMenu(msg);
            } else {
                await showCustomerMenu(msg);
            }
        }
        else if (data === 'refresh_userbot_status') {
            // Silent refresh - no popup notifications
            await bot.answerCallbackQuery(query.id, {
                text: "Status diperbarui",
                show_alert: false
            }).catch(() => {});
            
            // Clear cache untuk force refresh dari database
            userbotStatusCache.delete(userId);
            
            // CRITICAL FIX: Ensure correct message context with proper user ID
            const refreshMsg = {
                ...msg,
                from: { id: userId, first_name: query.from.first_name || 'User' },
                chat: { id: msg.chat.id }
            };
            
            // Refresh customer menu dengan data terbaru
            await new Promise(resolve => setTimeout(resolve, 200)); // Faster refresh
            await showCustomerMenu(refreshMsg);
            
            console.log(`[SILENT REFRESH]`.green + ` Userbot status refreshed for user ${userId}`);
        }
        else if (data.startsWith('control_ubot_')) {
            await showUserbotControlPanel(msg);
        }
        else if (data.startsWith('refresh_status_')) {
            const userbotId = parseInt(data.split('_')[2]);
            await bot.answerCallbackQuery(query.id, {
                text: "🔄 Status diperbarui!",
                show_alert: false
            }).catch(() => {});

            // Refresh control panel
            let userDataObj = userData.get(userId) || {};
            userDataObj.selected_userbot_id = userbotId;
            userData.set(userId, userDataObj);
            msg.data = `control_ubot_${userbotId}`;
            await showUserbotControlPanel(msg);
        }
        else if (data.startsWith('toggle_')) {
            if (!(await subscriptionGate(query, userId))) return;

            const userbotId = parseInt(data.split('_')[1]);
            const config = await database.getJasebConfig(userbotId);

            if (!config || !config.type) {
                await bot.answerCallbackQuery(query.id, {
                    text: "❌ Set pesan sebar dulu sebelum memulai!",
                    show_alert: true
                }).catch(() => {});
                return;
            }

            const newStatus = await database.toggleJasebStatus(userbotId);
            const statusText = newStatus ? "dimulai" : "dihentikan";

            await bot.answerCallbackQuery(query.id, {
                text: `✅ Proses sebar pesan telah ${statusText}.`,
                show_alert: true
            }).catch(() => {});

            // Refresh control panel
            let userDataObj = userData.get(userId) || {};
            userDataObj.selected_userbot_id = userbotId;
            userData.set(userId, userDataObj);
            await showUserbotControlPanel(msg, `Proses sebar pesan telah ${statusText}`);
        }
        else if (data === 'admin_extend_sub') {
            userStates.set(userId, ConversationStates.GET_EXTEND_ID);
            await bot.editMessageText("Masukkan ID Pelanggan:", {
                chat_id: msg.chat.id,
                message_id: msg.message_id
            }).catch(() => {});
        }
        else if (data === 'admin_add_userbot') {
            userStates.set(userId, ConversationStates.GET_OWNER_ID_FOR_USERBOT);
            await bot.editMessageText("*Masukkan ID Pelanggan pemilik userbot:*", {
                chat_id: msg.chat.id,
                message_id: msg.message_id,
                parse_mode: 'Markdown'
            }).catch(() => {});
        }
        else if (data.startsWith('set_msg_')) {
            if (!(await subscriptionGate(query, userId))) return;

            const userbotId = parseInt(data.split('_')[2]);
            let userDataObj = userData.get(userId) || {};
            userDataObj.selected_userbot_id = userbotId;
            userData.set(userId, userDataObj);

            userStates.set(userId, ConversationStates.GET_JASEB_MESSAGE);
            await bot.editMessageText("✍️ Kirim pesan untuk disebar (teks, foto, atau video).\n\n📋 *Format yang didukung:*\n• Teks biasa\n• Foto dengan caption\n• Video dengan caption\n\n💡 Kirim /cancel untuk membatalkan.", {
                chat_id: msg.chat.id,
                message_id: msg.message_id,
                parse_mode: 'Markdown'
            }).catch(() => {});
        }
        else if (data.startsWith('set_delay_')) {
            if (!(await subscriptionGate(query, userId))) return;

            const userbotId = parseInt(data.split('_')[2]);
            let userDataObj = userData.get(userId) || {};
            userDataObj.selected_userbot_id = userbotId;
            userData.set(userId, userDataObj);

            userStates.set(userId, ConversationStates.GET_JASEB_DELAY);
            await bot.editMessageText("⏱️ Masukkan jeda antar grup (detik, min. 10):\n\n💡 Jeda yang disarankan:\n• 10-15 detik: Cepat\n• 20-30 detik: Normal (Recommended)\n• 40-60 detik: Aman\n\nKirim /cancel untuk membatalkan.", {
                chat_id: msg.chat.id,
                message_id: msg.message_id,
                parse_mode: 'Markdown'
            }).catch(() => {});
        }
        else if (data === 'redeem_code_start') {
            userStates.set(userId, ConversationStates.GET_REDEEM_CODE);
            const text = "🎁 *Tukar Kode Redeem*\n\n📝 **Instruksi:**\n1. Masukkan kode redeem Anda di pesan berikutnya\n2. Kode redeem biasanya dalam format: JASEB-XXXXXXXX\n3. Pastikan kode yang Anda masukkan benar\n\n💡 **Tips:** Salin-tempel kode untuk menghindari kesalahan pengetikan.\n\n⬇️ **Silakan kirim kode redeem Anda sekarang:**";

            const keyboard = {
                inline_keyboard: [
                    [{ text: "❌ Batal", callback_data: 'cancel_redeem' }]
                ]
            };

            await bot.editMessageText(text, {
                chat_id: msg.chat.id,
                message_id: msg.message_id,
                parse_mode: 'Markdown',
                reply_markup: keyboard
            }).catch(() => {});
        }
        else if (data === 'cancel_redeem') {
            userStates.delete(userId);
            await showCustomerMenu(msg);
        }
        else if (data === 'customer_renew_info') {
            const isSubscribed = await database.isUserSubscribed(userId);
            const expiryDate = await database.getSubscriptionEndDate(userId);
            const statusText = isSubscribed ? "🟢 Aktif" : "🔴 Tidak Aktif";

            const text = `💳 *Bantuan & Informasi*\n\n📋 **Status Akun Anda:**\n• Status Langganan: ${statusText}\n• Berakhir Pada: \`${expiryDate}\`\n\n🆘 **Butuh Bantuan?**\nUntuk perpanjangan, aktivasi, atau jika mengalami kendala, silakan hubungi admin melalui tombol di bawah.\n\n📞 **Kontak Admin:**\nAdmin tersedia 24/7 untuk membantu Anda.`;

            const keyboard = {
                inline_keyboard: [
                    [{ text: "💬 Hubungi Admin", url: `tg://user?id=${config.ADMIN_IDS[0]}` }],
                    [{ text: "🔄 Refresh Status", callback_data: 'customer_renew_info' }],
                    [{ text: "⬅️ Kembali ke Menu Utama", callback_data: 'back_to_customer' }]
                ]
            };
            await sendOrEdit(msg, text, keyboard);
        }
        else if (data === 'admin_list_customers') {
            const customers = await database.getAllSubscriptions();
            let text = "*👥 List Pelanggan Aktif:*\n\n";
            
            if (customers.length === 0) {
                text = "Belum ada pelanggan.";
            } else {
                for (const cust of customers) {
                    text += `• Nama: ${escapeMarkdown(cust.first_name)}\n  ID: \`${cust.user_id}\`\n  Jml Bot: ${cust.bot_count}\n  Expire: \`${cust.end_date}\`\n\n`;
                }
            }
            
            const keyboard = {
                inline_keyboard: [[{ text: "⬅️ Kembali", callback_data: 'back_to_admin' }]]
            };
            await sendOrEdit(msg, text, keyboard);
        }
        else if (data === 'admin_redeem') {
            userStates.set(userId, ConversationStates.GET_REDEEM_DURATION);
            await bot.editMessageText("Masukkan nilai durasi kode (hari):", {
                chat_id: msg.chat.id,
                message_id: msg.message_id
            }).catch(() => {});
        }
        else if (data === 'admin_broadcast') {
            userStates.set(userId, ConversationStates.GET_BROADCAST_MESSAGE);
            await bot.editMessageText("Kirim pesan untuk di-broadcast (teks/foto/video):", {
                chat_id: msg.chat.id,
                message_id: msg.message_id
            }).catch(() => {});
        }
        else if (data === 'admin_promo') {
            const [keywords, message] = await database.getDefaultPromoSettings();
            const text = `*Pengaturan Promo Default*\n\nPengaturan ini akan diterapkan ke semua userbot baru.\n\nKata Kunci: \`${escapeMarkdown(keywords)}\`\nPesan: \`${escapeMarkdown(message)}\``;
            
            const keyboard = {
                inline_keyboard: [
                    [{ text: "✏️ Ubah Kata Kunci", callback_data: 'promo_set_keywords' }],
                    [{ text: "📝 Ubah Pesan", callback_data: 'promo_set_message' }],
                    [{ text: "⬅️ Kembali", callback_data: 'back_to_admin' }]
                ]
            };
            await sendOrEdit(msg, text, keyboard);
        }
        else if (data === 'promo_set_keywords') {
            userStates.set(userId, ConversationStates.GET_PROMO_KEYWORDS);
            await bot.editMessageText("Kirimkan kata kunci default baru, pisahkan dengan koma:", {
                chat_id: msg.chat.id,
                message_id: msg.message_id
            }).catch(() => {});
        }
        else if (data === 'promo_set_message') {
            userStates.set(userId, ConversationStates.GET_PROMO_MESSAGE);
            await bot.editMessageText("Kirimkan teks pesan default yang baru:", {
                chat_id: msg.chat.id,
                message_id: msg.message_id
            }).catch(() => {});
        }
        else if (data.startsWith('pm_reply_menu_')) {
            if (!(await subscriptionGate(query, userId))) return;
            
            const userbotId = parseInt(data.split('_')[3]);
            let userDataObj = userData.get(userId) || {};
            userDataObj.selected_userbot_id = userbotId;
            userData.set(userId, userDataObj);
            
            const config = await database.getJasebConfig(userbotId);
            const status = config && config.pm_reply_status;
            const replyText = config && config.pm_reply_text || "_Belum diatur_";
            
            const statusText = status ? "🟢 *Aktif*" : "🔴 *Tidak Aktif*";
            const toggleText = status ? "🔴 Nonaktifkan" : "🟢 Aktifkan";
            
            const text = `💬 *Auto-Reply Private Message*\n\n📊 **Status Sistem:**\n• Status: ${statusText}\n• Pesan Balasan: ${replyText === "_Belum diatur_" ? "❌ Belum diatur" : "✅ Sudah diatur"}\n\n📝 **Pesan Balasan Saat Ini:**\n\`${escapeMarkdown(replyText)}\`\n\n⚙️ **Pengaturan:**`;
            
            const keyboard = {
                inline_keyboard: [
                    [{ text: toggleText, callback_data: `toggle_pm_reply_${userbotId}` }],
                    [{ text: "✏️ Ubah Pesan Balasan", callback_data: `set_pm_text_${userbotId}` }],
                    [{ text: "❓ Bantuan Auto-Reply PM", callback_data: `help_pm_reply_${userbotId}` }],
                    [{ text: "⬅️ Kembali ke Panel Kontrol", callback_data: `control_ubot_${userbotId}` }]
                ]
            };
            await sendOrEdit(msg, text, keyboard);
        }
        else if (data.startsWith('help_pm_reply_')) {
            const userbotId = parseInt(data.split('_')[3]);
            const text = `❓ *Bantuan Auto-Reply PM*\n\n🤖 **Fungsi:**\nFitur ini akan membalas semua pesan pribadi yang masuk ke userbot Anda secara otomatis.\n\n⚙️ **Cara Kerja:**\n1. Aktifkan fitur ini\n2. Atur pesan balasan\n3. Userbot akan membalas semua PM masuk dengan pesan yang telah Anda atur\n\n💡 **Tips:**\n• Gunakan pesan yang informatif\n• Jangan gunakan pesan spam\n• Periksa secara berkala apakah fitur masih diperlukan`;
            
            const keyboard = {
                inline_keyboard: [
                    [{ text: "⬅️ Kembali ke Pengaturan", callback_data: `pm_reply_menu_${userbotId}` }]
                ]
            };
            await sendOrEdit(msg, text, keyboard);
        }
        else if (data.startsWith('toggle_pm_reply_')) {
            if (!(await subscriptionGate(query, userId))) return;
            
            const userbotId = parseInt(data.split('_')[3]);
            const config = await database.getJasebConfig(userbotId);
            const newStatus = !(config && config.pm_reply_status);
            
            await database.setPmReplyStatus(userbotId, newStatus);
            
            await bot.answerCallbackQuery(query.id, {
                text: `✅ Auto-reply PM ${newStatus ? 'diaktifkan' : 'dinonaktifkan'}.`,
                show_alert: true
            }).catch(() => {});
            
            // Refresh menu
            msg.data = `pm_reply_menu_${userbotId}`;
            const newQuery = { ...query, data: msg.data };
            await bot.emit('callback_query', newQuery);
        }
        else if (data.startsWith('set_pm_text_')) {
            if (!(await subscriptionGate(query, userId))) return;
            
            const userbotId = parseInt(data.split('_')[3]);
            let userDataObj = userData.get(userId) || {};
            userDataObj.selected_userbot_id = userbotId;
            userData.set(userId, userDataObj);
            
            userStates.set(userId, ConversationStates.GET_PM_REPLY_TEXT);
            await bot.editMessageText("Kirimkan teks balasan PM yang baru:", {
                chat_id: msg.chat.id,
                message_id: msg.message_id
            }).catch(() => {});
        }
        else if (data.startsWith('promo_menu_')) {
            if (!(await subscriptionGate(query, userId))) return;
            
            const userbotId = parseInt(data.split('_')[2]);
            let userDataObj = userData.get(userId) || {};
            userDataObj.selected_userbot_id = userbotId;
            userData.set(userId, userDataObj);
            
            const config = await database.getJasebConfig(userbotId);
            const status = config && config.promo_status;
            const keywords = config && config.promo_keywords || "_Belum diatur_";
            const message = config && config.promo_message || "_Belum diatur_";
            
            const statusText = status ? "🟢 *Aktif*" : "🔴 *Tidak Aktif*";
            const toggleText = status ? "🔴 Nonaktifkan" : "🟢 Aktifkan";
            
            const text = `📣 *Pengaturan Auto-Reply Grup*\n\nStatus: ${statusText}\nKata Kunci: \`${escapeMarkdown(keywords)}\`\nPesan Balasan:\n\`${escapeMarkdown(message)}\``;
            
            const keyboard = {
                inline_keyboard: [
                    [{ text: toggleText, callback_data: `toggle_promo_${userbotId}` }],
                    [{ text: "✏️ Ubah Kata Kunci", callback_data: `set_promo_keys_${userbotId}` }],
                    [{ text: "📝 Ubah Pesan", callback_data: `set_promo_msg_${userbotId}` }],
                    [{ text: "⬅️ Kembali", callback_data: `control_ubot_${userbotId}` }]
                ]
            };
            await sendOrEdit(msg, text, keyboard);
        }
        else if (data.startsWith('toggle_promo_')) {
            if (!(await subscriptionGate(query, userId))) return;
            
            const userbotId = parseInt(data.split('_')[2]);
            const config = await database.getJasebConfig(userbotId);
            const newStatus = !(config && config.promo_status);
            
            await database.setUserbotPromoConfig(userbotId, newStatus, null, null);
            
            await bot.answerCallbackQuery(query.id, {
                text: `✅ Auto-reply grup ${newStatus ? 'diaktifkan' : 'dinonaktifkan'}.`,
                show_alert: true
            }).catch(() => {});
            
            // Refresh menu
            msg.data = `promo_menu_${userbotId}`;
            const newQuery = { ...query, data: msg.data };
            await bot.emit('callback_query', newQuery);
        }
        else if (data.startsWith('set_promo_keys_')) {
            if (!(await subscriptionGate(query, userId))) return;
            
            const userbotId = parseInt(data.split('_')[3]);
            let userDataObj = userData.get(userId) || {};
            userDataObj.selected_userbot_id = userbotId;
            userData.set(userId, userDataObj);
            
            userStates.set(userId, ConversationStates.GET_PROMO_USERBOT_KEYWORDS);
            await bot.editMessageText("Kirimkan kata kunci baru, pisahkan dengan koma:", {
                chat_id: msg.chat.id,
                message_id: msg.message_id
            }).catch(() => {});
        }
        else if (data.startsWith('set_promo_msg_')) {
            if (!(await subscriptionGate(query, userId))) return;
            
            const userbotId = parseInt(data.split('_')[3]);
            let userDataObj = userData.get(userId) || {};
            userDataObj.selected_userbot_id = userbotId;
            userData.set(userId, userDataObj);
            
            userStates.set(userId, ConversationStates.GET_PROMO_USERBOT_MESSAGE);
            await bot.editMessageText("Kirimkan pesan balasan baru:", {
                chat_id: msg.chat.id,
                message_id: msg.message_id
            }).catch(() => {});
        }
        else if (data.startsWith('auto_chat_menu_')) {
            if (!(await subscriptionGate(query, userId))) return;
            
            const userbotId = parseInt(data.split('_')[3]);
            let userDataObj = userData.get(userId) || {};
            userDataObj.selected_userbot_id = userbotId;
            userData.set(userId, userDataObj);
            
            const config = await database.getAutoChatConfig(userbotId);
            const status = config && config.auto_chat_status;
            const target = config && config.auto_chat_target || "_Belum diatur_";
            const delay = config && config.auto_chat_delay || 30;
            const message = config && config.auto_chat_message || "_Belum diatur_";
            
            const statusText = status ? "🟢 *Aktif*" : "🔴 *Tidak Aktif*";
            const toggleText = status ? "🔴 Nonaktifkan" : "🟢 Aktifkan";
            
            const targetCount = target !== "_Belum diatur_" ? target.split(',').length : 0;
            
            const text = `👥 *Auto Chat Member Group*\n\n📊 **Status Sistem:**\n• Status: ${statusText}\n• Target Group: ${targetCount > 0 ? `✅ ${targetCount} grup` : "❌ Belum diatur"}\n• Jeda Antar Chat: \`${delay} detik\`\n• Pesan: ${message !== "_Belum diatur_" ? "✅ Sudah diatur" : "❌ Belum diatur"}\n\n🎯 **Target Group:**\n\`${escapeMarkdown(target)}\`\n\n📝 **Pesan Chat:**\n\`${escapeMarkdown(message.substring(0, 100))}${message.length > 100 ? '...' : ''}\`\n\n⚙️ **Pengaturan:**`;
            
            const keyboard = {
                inline_keyboard: [
                    [{ text: toggleText, callback_data: `toggle_auto_chat_${userbotId}` }],
                    [
                        { text: "🎯 Set Target Group", callback_data: `set_auto_chat_target_${userbotId}` },
                        { text: "⏱️ Set Jeda Chat", callback_data: `set_auto_chat_delay_${userbotId}` }
                    ],
                    [{ text: "📝 Set Pesan Chat", callback_data: `set_auto_chat_msg_${userbotId}` }],
                    [{ text: "❓ Bantuan Auto Chat", callback_data: `help_auto_chat_${userbotId}` }],
                    [{ text: "⬅️ Kembali ke Panel Kontrol", callback_data: `control_ubot_${userbotId}` }]
                ]
            };
            await sendOrEdit(msg, text, keyboard);
        }
        else if (data.startsWith('help_auto_chat_')) {
            const userbotId = parseInt(data.split('_')[3]);
            const text = `❓ *Bantuan Auto Chat Member*\n\n🤖 **Fungsi:**\nFitur ini akan mengirim pesan otomatis ke semua member dalam grup yang ditargetkan.\n\n⚙️ **Cara Kerja:**\n1. Set target grup (bisa lebih dari 1)\n2. Set jeda antar chat (minimal 30 detik)\n3. Set pesan yang akan dikirim\n4. Aktifkan fitur\n\n📝 **Format Target:**\n• @namagrup (untuk public group)\n• https://t.me/namagrup (untuk group link)\n• Pisahkan dengan koma untuk multi target\n\n⚠️ **Peringatan:**\n• Gunakan jeda yang wajar (min 30 detik)\n• Jangan spam member\n• Pastikan pesan relevan dan tidak melanggar aturan grup`;
            
            const keyboard = {
                inline_keyboard: [
                    [{ text: "⬅️ Kembali ke Pengaturan", callback_data: `auto_chat_menu_${userbotId}` }]
                ]
            };
            await sendOrEdit(msg, text, keyboard);
        }
        else if (data.startsWith('toggle_auto_chat_')) {
            if (!(await subscriptionGate(query, userId))) return;
            
            const userbotId = parseInt(data.split('_')[3]);
            const config = await database.getAutoChatConfig(userbotId);
            const newStatus = !(config && config.auto_chat_status);
            
            await database.setAutoChatStatus(userbotId, newStatus);
            
            await bot.answerCallbackQuery(query.id, {
                text: `✅ Auto chat member ${newStatus ? 'diaktifkan' : 'dinonaktifkan'}.`,
                show_alert: true
            }).catch(() => {});
            
            // Refresh menu
            msg.data = `auto_chat_menu_${userbotId}`;
            const newQuery = { ...query, data: msg.data };
            await bot.emit('callback_query', newQuery);
        }
        else if (data.startsWith('set_auto_chat_target_')) {
            if (!(await subscriptionGate(query, userId))) return;
            
            const userbotId = parseInt(data.split('_')[4]);
            let userDataObj = userData.get(userId) || {};
            userDataObj.selected_userbot_id = userbotId;
            userData.set(userId, userDataObj);
            
            userStates.set(userId, ConversationStates.GET_AUTO_CHAT_TARGET);
            await bot.editMessageText("Kirimkan target grup, pisahkan dengan koma jika lebih dari 1:\n\nContoh:\n@grupA, @grupB, https://t.me/grupC", {
                chat_id: msg.chat.id,
                message_id: msg.message_id
            }).catch(() => {});
        }
        else if (data.startsWith('set_auto_chat_delay_')) {
            if (!(await subscriptionGate(query, userId))) return;
            
            const userbotId = parseInt(data.split('_')[4]);
            let userDataObj = userData.get(userId) || {};
            userDataObj.selected_userbot_id = userbotId;
            userData.set(userId, userDataObj);
            
            userStates.set(userId, ConversationStates.GET_AUTO_CHAT_DELAY);
            await bot.editMessageText("Masukkan jeda antar chat (detik, minimal 30):", {
                chat_id: msg.chat.id,
                message_id: msg.message_id
            }).catch(() => {});
        }
        else if (data.startsWith('set_auto_chat_msg_')) {
            if (!(await subscriptionGate(query, userId))) return;
            
            const userbotId = parseInt(data.split('_')[4]);
            let userDataObj = userData.get(userId) || {};
            userDataObj.selected_userbot_id = userbotId;
            userData.set(userId, userDataObj);
            
            userStates.set(userId, ConversationStates.GET_AUTO_CHAT_MESSAGE);
            await bot.editMessageText("Kirim pesan untuk auto chat (teks, foto, atau video):", {
                chat_id: msg.chat.id,
                message_id: msg.message_id
            }).catch(() => {});
        }
        else if (data.startsWith('auto_join_menu_')) {
            if (!(await subscriptionGate(query, userId))) return;
            
            const userbotId = parseInt(data.split('_')[3]);
            let userDataObj = userData.get(userId) || {};
            userDataObj.selected_userbot_id = userbotId;
            userData.set(userId, userDataObj);
            
            const config = await database.getAutoJoinConfig(userbotId);
            const status = config && config.auto_join_status;
            const target = config && config.auto_join_target || "_Belum diatur_";
            const delay = config && config.auto_join_delay || 60;
            const joinCount = config && config.join_count || 0;
            
            const statusText = status ? "🟢 *Aktif*" : "🔴 *Tidak Aktif*";
            const toggleText = status ? "🔴 Nonaktifkan" : "🟢 Aktifkan";
            
            const targetCount = target !== "_Belum diatur_" ? target.split(',').length : 0;
            
            const text = `🔗 *Auto Join Group*\n\n📊 **Status Sistem:**\n• Status: ${statusText}\n• Target Group: ${targetCount > 0 ? `✅ ${targetCount} grup` : "❌ Belum diatur"}\n• Jeda Antar Join: \`${delay} detik\`\n• Join Count: \`${joinCount}/5\`\n\n🎯 **Target Group:**\n\`${escapeMarkdown(target)}\`\n\n⚙️ **Pengaturan:**`;
            
            const keyboard = {
                inline_keyboard: [
                    [{ text: toggleText, callback_data: `toggle_auto_join_${userbotId}` }],
                    [
                        { text: "🎯 Set Target Group", callback_data: `set_auto_join_target_${userbotId}` },
                        { text: "⏱️ Set Jeda Join", callback_data: `set_auto_join_delay_${userbotId}` }
                    ],
                    [{ text: "❓ Bantuan Auto Join", callback_data: `help_auto_join_${userbotId}` }],
                    [{ text: "⬅️ Kembali ke Panel Kontrol", callback_data: `control_ubot_${userbotId}` }]
                ]
            };
            await sendOrEdit(msg, text, keyboard);
        }
        else if (data.startsWith('help_auto_join_')) {
            const userbotId = parseInt(data.split('_')[3]);
            const text = `❓ *Bantuan Auto Join Group*\n\n🤖 **Fungsi:**\nFitur ini akan otomatis join ke grup-grup yang ditargetkan.\n\n⚙️ **Cara Kerja:**\n1. Set target grup (bisa lebih dari 1)\n2. Set jeda antar join (minimal 60 detik)\n3. Aktifkan fitur\n4. Bot akan istirahat otomatis setelah 5 join\n\n📝 **Format Target:**\n• @namagrup (untuk public group)\n• https://t.me/joinchat/xxx (untuk invite link)\n• Pisahkan dengan koma untuk multi target\n\n⚠️ **Peringatan:**\n• Gunakan jeda yang aman (min 60 detik)\n• Bot akan istirahat otomatis setelah 5 join\n• Pastikan link grup masih aktif`;
            
            const keyboard = {
                inline_keyboard: [
                    [{ text: "⬅️ Kembali ke Pengaturan", callback_data: `auto_join_menu_${userbotId}` }]
                ]
            };
            await sendOrEdit(msg, text, keyboard);
        }
        else if (data.startsWith('toggle_auto_join_')) {
            if (!(await subscriptionGate(query, userId))) return;
            
            const userbotId = parseInt(data.split('_')[3]);
            const config = await database.getAutoJoinConfig(userbotId);
            const newStatus = !(config && config.auto_join_status);
            
            await database.setAutoJoinStatus(userbotId, newStatus);
            
            await bot.answerCallbackQuery(query.id, {
                text: `✅ Auto join group ${newStatus ? 'diaktifkan' : 'dinonaktifkan'}.`,
                show_alert: true
            }).catch(() => {});
            
            // Refresh menu
            msg.data = `auto_join_menu_${userbotId}`;
            const newQuery = { ...query, data: msg.data };
            await bot.emit('callback_query', newQuery);
        }
        else if (data.startsWith('set_auto_join_target_')) {
            if (!(await subscriptionGate(query, userId))) return;
            
            const userbotId = parseInt(data.split('_')[4]);
            let userDataObj = userData.get(userId) || {};
            userDataObj.selected_userbot_id = userbotId;
            userData.set(userId, userDataObj);
            
            userStates.set(userId, ConversationStates.GET_AUTO_JOIN_TARGET);
            await bot.editMessageText("Kirimkan target grup untuk auto join, pisahkan dengan koma:\n\nContoh:\n@grupA, @grupB, https://t.me/joinchat/xxx", {
                chat_id: msg.chat.id,
                message_id: msg.message_id
            }).catch(() => {});
        }
        else if (data.startsWith('set_auto_join_delay_')) {
            if (!(await subscriptionGate(query, userId))) return;
            
            const userbotId = parseInt(data.split('_')[4]);
            let userDataObj = userData.get(userId) || {};
            userDataObj.selected_userbot_id = userbotId;
            userData.set(userId, userDataObj);
            
            userStates.set(userId, ConversationStates.GET_AUTO_JOIN_DELAY);
            await bot.editMessageText("Masukkan jeda antar join (detik, minimal 60):", {
                chat_id: msg.chat.id,
                message_id: msg.message_id
            }).catch(() => {});
        }
        else if (data.startsWith('view_log_')) {
            if (!(await subscriptionGate(query, userId))) return;
            
            const userbotId = parseInt(data.split('_')[2]);
            try {
                const logs = await database.getLatestJasebLogs(userbotId, 10);
                let logText = `📊 *Log Aktivitas Userbot*\n\n`;
                
                if (logs.length === 0) {
                    logText += "Belum ada aktivitas yang tercatat.";
                } else {
                    for (const log of logs) {
                        logText += `\`${log.timestamp}\` ${log.log_text}\n\n`;
                    }
                }
                
                const keyboard = {
                    inline_keyboard: [
                        [{ text: "🔄 Refresh Log", callback_data: `view_log_${userbotId}` }],
                        [{ text: "⬅️ Kembali ke Panel Kontrol", callback_data: `control_ubot_${userbotId}` }]
                    ]
                };
                
                await sendOrEdit(msg, logText, keyboard);
            } catch (error) {
                await bot.answerCallbackQuery(query.id, {
                    text: "❌ Gagal memuat log aktivitas.",
                    show_alert: true
                }).catch(() => {});
            }
        }

    } catch (error) {
        console.error('[CALLBACK QUERY]'.red + ' Error:', error.message);
        console.error('[CALLBACK QUERY]'.red + ' Stack:', error.stack);
        await bot.answerCallbackQuery(query.id, {
            text: "❌ Terjadi kesalahan. Silakan coba lagi.",
            show_alert: true
        }).catch(() => {});
    }
});

// Start the bot automatically
startPolling();

console.log('[BOT]'.green + ' Bot siap dan polling dimulai!');

// Export bot instance and functions for external use
module.exports = {
    bot,
    startPolling,
    isPolling,
    logToChannel,
    refreshUserbotStatus
};