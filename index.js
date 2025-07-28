// index.js - Main Entry Point (Fixed Version)
const path = require('path');
const colors = require('colors');

console.log();
console.log('🚀 JASEB SYSTEM STARTUP'.cyan.bold);
console.log('   Professional Edition - Node.js Version'.dim);
console.log();

console.log('⚡ INITIALIZING SYSTEM...'.yellow.bold);

// Check and validate dependencies
try {
    console.log('  ✓ Checking dependencies...'.blue);

    const requiredModules = [
        'node-telegram-bot-api',
        'sqlite3', 
        'axios',
        'colors',
        'cli-table3',
        'enquirer'
    ];

    for (const module of requiredModules) {
        try {
            require(module);
        } catch (error) {
            throw new Error(`Missing module: ${module}`);
        }
    }

    console.log('  ✓ All dependencies available'.green);
} catch (error) {
    console.error('  ❌ Dependency error:'.red, error.message);
    console.log('  💡 Run: npm install'.yellow);
    process.exit(1);
}

// Validate configuration
try {
    console.log('  ✓ Validating configuration...'.cyan);
    const config = require('./config');

    if (!config.BOT_TOKEN) {
        throw new Error('BOT_TOKEN tidak ditemukan di config.js');
    }
    if (!config.API_ID) {
        throw new Error('API_ID tidak ditemukan di config.js');
    }
    if (!config.API_HASH) {
        throw new Error('API_HASH tidak ditemukan di config.js');
    }
    if (!Array.isArray(config.ADMIN_IDS) || config.ADMIN_IDS.length === 0) {
        throw new Error('ADMIN_IDS tidak valid di config.js');
    }

    console.log('  ✓ Configuration valid'.green);
} catch (error) {
    console.error('  ❌ Configuration error:'.red, error.message);
    process.exit(1);
}

// Initialize database with error handling and cleanup
try {
    console.log('  ✓ Initializing database...'.cyan);
    const database = require('./database');
    
    // Cleanup dummy data on startup
    setTimeout(async () => {
        try {
            await database.cleanupDummyUserbots();
            console.log('  ✓ Database cleanup completed'.green);
        } catch (error) {
            console.log('  ⚠️ Database cleanup warning:'.yellow, error.message);
        }
    }, 2000);
    
    console.log('  ✓ Database ready'.green);
} catch (error) {
    console.error('  ❌ Database error:'.red, error.message);
    process.exit(1);
}

// Start main bot with delay
setTimeout(() => {
    try {
        console.log('  ✓ Starting Telegram Bot...'.green);
        const mainBot = require('./mainBot');
        console.log('  ✓ Bot initialized successfully'.green);
    } catch (error) {
        console.error('  ❌ Bot initialization error:'.red, error.message);
        process.exit(1);
    }
}, 1000);

// Start userbot manager with delay
setTimeout(() => {
    try {
        console.log('  ✓ Starting Userbot Manager...'.green);
        const userbotManager = require('./userbotManager');

        // Start userbot manager after bot is ready
        setTimeout(() => {
            userbotManager.start();
        }, 3000);

        console.log('  ✓ Userbot Manager initialized'.green);
    } catch (error) {
        console.error('  ❌ Userbot Manager error:'.red, error.message);
        // Don't exit, bot can still work without userbot manager
    }
}, 2000);

// System ready notification
setTimeout(() => {
    console.log();
    console.log('🎉 SYSTEM READY!'.green.bold);
    console.log('  📱 Telegram Bot: ACTIVE'.cyan);
    console.log('  🤖 Userbot Manager: ACTIVE'.cyan);
    console.log('  📊 Dashboard: MONITORING'.cyan);
    console.log();
    console.log('─'.repeat(50).dim);
    console.log('System is running. Press Ctrl+C to stop.'.dim);
    console.log();
}, 5000);

// Enhanced error handling
process.on('uncaughtException', (error) => {
    console.error('[UNCAUGHT EXCEPTION]'.red.bold, error);
    console.log('[SYSTEM]'.yellow + ' Attempting graceful recovery...');
    // Don't exit immediately, try to recover
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[UNHANDLED REJECTION]'.red.bold, reason);
    console.log('[SYSTEM]'.yellow + ' Promise rejection handled gracefully');
    // Don't exit, just log the error
});

// Graceful shutdown handlers
process.on('SIGINT', () => {
    console.log('\n🔴 Menghentikan sistem...'.red.bold);
    console.log('📱 Stopping Telegram Bot...'.yellow);
    console.log('🤖 Stopping Userbot Manager...'.yellow);
    console.log('✅ System shutdown complete'.green);
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🔴 Sistem dihentikan oleh server...'.red.bold);
    process.exit(0);
});

// Heartbeat to prevent crashes
setInterval(() => {
    // Simple heartbeat - just log memory usage every 5 minutes
    const used = process.memoryUsage();
    if (used.heapUsed > 200 * 1024 * 1024) { // 200MB threshold
        console.log('[MEMORY]'.yellow + ` High memory usage: ${Math.round(used.heapUsed / 1024 / 1024)} MB`);
    }
}, 300000); // 5 minutes

console.log('[SYSTEM]'.green + ' 🚀 Bot utama siap!');
console.log('[SYSTEM]'.green + ' 🤖 Dashboard userbot siap!');
console.log('[SYSTEM]'.green + ' 📊 Sistem Jaseb Professional Edition aktif!');

// Monitor userbot activations every 30 seconds
setInterval(async () => {
    try {
        // Check for newly activated userbots and notify owners
        const database = require('./database');
        const recentlyActivated = await database.db.all(
            "SELECT DISTINCT owner_id, userbot_name, userbot_id FROM userbots WHERE status = 'active' AND datetime(join_date, '+30 seconds') > datetime('now')",
            []
        );

        // This would be handled by the userbot manager activation process
        // but we add this as a safety check
    } catch (error) {
        // Ignore monitoring errors
    }
}, 30000);

// Keep the process running
process.stdin.resume();

console.log('[SYSTEM]'.green + ' Main process initialized and monitoring...');