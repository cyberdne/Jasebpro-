
// loginHelper.js - Login Helper (Converted from Python)
const fs = require('fs');
const path = require('path');
const { prompt } = require('enquirer');

const SESSION_NAME = "login_bantuan";

async function main() {
    console.log("🚀 Skrip Bantuan Login Userbot 🚀");
    
    // Remove old session file if exists
    const sessionFile = `${SESSION_NAME}.session`;
    if (fs.existsSync(sessionFile)) {
        fs.unlinkSync(sessionFile);
        console.log("ℹ️ File sesi lama (.session) ditemukan dan telah dihapus untuk memulai login baru.");
    }
    
    try {
        const { api_id } = await prompt({
            type: 'input',
            name: 'api_id',
            message: 'Masukkan API ID Anda:',
            validate: (value) => {
                const num = parseInt(value);
                return !isNaN(num) && num > 0 ? true : 'API ID harus berupa angka positif';
            }
        });
        
        const { api_hash } = await prompt({
            type: 'password',
            name: 'api_hash',
            message: 'Masukkan API Hash Anda:'
        });
        
        // Note: In real implementation, you would use actual Pyrogram/Telegram client
        // This is a mock implementation for demonstration
        console.log("\n✅ Login Berhasil!");
        console.log(`  API ID: ${api_id}`);
        console.log(`  API Hash: ${api_hash.substring(0, 8)}...`);
        
        // Generate a mock session string
        const sessionString = Buffer.from(`${api_id}:${api_hash}:${Date.now()}`).toString('base64');
        
        console.log("\n🔑 SESSION STRING ANDA 👇");
        console.log("==================================================");
        console.log(sessionString);
        console.log("==================================================");
        
        console.log("\n⚠️ PENTING: Ini adalah session string mock untuk demonstrasi.");
        console.log("Untuk implementasi nyata, gunakan library Telegram client yang sesuai.");
        
    } catch (error) {
        if (error.name === 'ValueError' || error.message.includes('API')) {
            console.log("\n❌ [ERROR] API ID atau API Hash tidak valid.");
        } else if (error.message.includes('PhoneCode') || error.message.includes('Password')) {
            console.log("\n❌ [ERROR] Kode OTP atau Password 2FA salah.");
        } else {
            console.log(`\n❌ [ERROR] Terjadi kesalahan: ${error.message}`);
        }
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { main };
