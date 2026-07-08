const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const crypto = require('crypto');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { GoogleGenerativeAI } = require('@google/generative-ai');

class DiscordBot {
  constructor() {
    this.client = null;
    this.db = null;
  }

  async start() {
    if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_APP_ID) {
      console.log('[Discord] Bot token veya App ID bulunamadı, bot başlatılmadı.');
      return;
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
      ]
    });

    // Slash komutlarını kaydet
    await this.registerCommands();

    // Event handlers
    this.client.once('ready', () => {
      console.log(`[Discord] Bot aktif: ${this.client.user.tag}`);
      console.log(`[Discord] ${this.client.guilds.cache.size} sunucuda aktif`);
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      
      try {
        switch (interaction.commandName) {
          case 'keyal':
            await this.handleKeyAl(interaction);
            break;
          case 'keydurum':
            await this.handleKeyDurum(interaction);
            break;
          case 'keyolustur':
            await this.handleKeyOlustur(interaction);
            break;
          case 'otoduyuru':
            await this.handleOtoDuyuru(interaction);
            break;
          default:
            break;
        }
      } catch (error) {
        console.error('[Discord] Komut hatası:', error);
        const reply = { content: '❌ Bir hata oluştu, lütfen tekrar deneyin.', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply);
        } else {
          await interaction.reply(reply);
        }
      }
    });

    await this.client.login(process.env.DISCORD_BOT_TOKEN);
  }

  async registerCommands() {
    const commands = [
      new SlashCommandBuilder()
        .setName('keyal')
        .setDescription('🔑 Kick AutoMod sistemi için davet kodu al')
        .toJSON(),
      
      new SlashCommandBuilder()
        .setName('keydurum')
        .setDescription('📊 Mevcut davet kodlarının durumunu kontrol et')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .toJSON(),

      new SlashCommandBuilder()
        .setName('keyolustur')
        .setDescription('🔧 Manuel olarak davet kodu oluştur (Admin)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addIntegerOption(option =>
          option.setName('adet')
            .setDescription('Oluşturulacak key adedi (max 10)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(10))
        .toJSON(),
        
      new SlashCommandBuilder()
        .setName('otoduyuru')
        .setDescription('🤖 Yapay Zeka ile otomatik yama notu (patch notes) oluştur (Admin)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addIntegerOption(option =>
          option.setName('commit')
            .setDescription('Kaç adet son güncellemeyi (commit) okusun?')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(15))
        .addChannelOption(option =>
          option.setName('kanal')
            .setDescription('Duyurunun gönderileceği kanal')
            .setRequired(false))
        .toJSON(),
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
    
    try {
      console.log('[Discord] Slash komutları kaydediliyor...');
      await rest.put(
        Routes.applicationCommands(process.env.DISCORD_APP_ID),
        { body: commands }
      );
      console.log('[Discord] Slash komutları başarıyla kaydedildi!');
    } catch (error) {
      console.error('[Discord] Komut kayıt hatası:', error);
    }
  }

  // /keyal - Kullanıcıya yeni bir davet kodu verir
  async handleKeyAl(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const { InviteCode } = require('./db');
    
    // Kullanıcının Discord ID'si ile daha önce key alıp almadığını kontrol et
    const discordUserId = interaction.user.id;
    const discordUsername = interaction.user.username;

    // Aynı Discord kullanıcısına daha önce verilmiş kullanılmamış key var mı?
    const existingCode = await InviteCode.findOne({ 
      discordUserId: discordUserId,
      used: false 
    });

    if (existingCode) {
      const embed = new EmbedBuilder()
        .setTitle('🔑 Mevcut Davet Kodun')
        .setDescription('Zaten kullanılmamış bir davet kodun var!')
        .addFields(
          { name: '📋 Kod', value: `\`${existingCode.code}\``, inline: true },
          { name: '📅 Oluşturulma', value: `<t:${Math.floor(new Date(existingCode.createdAt).getTime() / 1000)}:R>`, inline: true }
        )
        .setColor(0xFFA500)
        .setFooter({ text: 'Kick AutoMod • Bu kodu sisteme giriş yaparken kullan' })
        .setTimestamp();
      
      return interaction.editReply({ embeds: [embed] });
    }

    // Yeni key oluştur
    const code = 'INV-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    
    await InviteCode.create({
      code: code,
      createdBy: `discord:${discordUsername}`,
      discordUserId: discordUserId,
      discordUsername: discordUsername
    });

    const embed = new EmbedBuilder()
      .setTitle('✅ Davet Kodun Oluşturuldu!')
      .setDescription('Aşağıdaki kodu Kick AutoMod sistemine giriş yaparken kullan.')
      .addFields(
        { name: '🔑 Davet Kodu', value: `\`${code}\``, inline: false },
        { name: '📌 Nasıl Kullanılır?', value: '1. Sisteme git\n2. Giriş yap\n3. Davet kodu sor alanına bu kodu yapıştır', inline: false }
      )
      .setColor(0x00FF00)
      .setFooter({ text: 'Kick AutoMod • Bu kod tek kullanımlıktır' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    
    console.log(`[Discord] Yeni key oluşturuldu: ${code} -> ${discordUsername} (${discordUserId})`);
  }

  // /keydurum - Admin: Kodların durumunu gösterir
  async handleKeyDurum(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const { InviteCode } = require('./db');
    
    const totalCodes = await InviteCode.countDocuments();
    const usedCodes = await InviteCode.countDocuments({ used: true });
    const unusedCodes = await InviteCode.countDocuments({ used: false });
    
    // Son 10 kodu getir
    const recentCodes = await InviteCode.find().sort({ createdAt: -1 }).limit(10);
    
    let codeList = recentCodes.map(c => {
      const status = c.used ? '🔴 Kullanıldı' : '🟢 Aktif';
      const user = c.discordUsername || c.createdBy || '?';
      return `\`${c.code}\` - ${status} - ${user}`;
    }).join('\n');

    if (!codeList) codeList = 'Henüz kod yok.';

    const embed = new EmbedBuilder()
      .setTitle('📊 Davet Kodu İstatistikleri')
      .addFields(
        { name: '📦 Toplam', value: `${totalCodes}`, inline: true },
        { name: '🟢 Aktif', value: `${unusedCodes}`, inline: true },
        { name: '🔴 Kullanılmış', value: `${usedCodes}`, inline: true },
        { name: '📋 Son 10 Kod', value: codeList, inline: false }
      )
      .setColor(0x5865F2)
      .setFooter({ text: 'Kick AutoMod Admin Panel' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }

  // /keyolustur - Admin: Manuel key oluşturma
  async handleKeyOlustur(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const { InviteCode } = require('./db');
    const adet = interaction.options.getInteger('adet') || 1;
    
    const createdCodes = [];
    
    for (let i = 0; i < adet; i++) {
      const code = 'INV-' + crypto.randomBytes(4).toString('hex').toUpperCase();
      await InviteCode.create({
        code: code,
        createdBy: `admin:${interaction.user.username}`,
        discordUserId: null,
        discordUsername: null
      });
      createdCodes.push(code);
    }

    const codeList = createdCodes.map(c => `\`${c}\``).join('\n');

    const embed = new EmbedBuilder()
      .setTitle(`🔧 ${adet} Adet Key Oluşturuldu`)
      .setDescription('Aşağıdaki kodlar kullanıma hazır:')
      .addFields(
        { name: '🔑 Kodlar', value: codeList, inline: false }
      )
      .setColor(0xFF6B35)
      .setFooter({ text: 'Kick AutoMod Admin Panel' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    
    console.log(`[Discord] Admin ${interaction.user.username} ${adet} key oluşturdu:`, createdCodes);
  }

  // /otoduyuru - AI Powered Announcement
  async handleOtoDuyuru(interaction) {
    // Mesajı defer ile bekletiyoruz çünkü API cevabı ve git log uzun sürebilir
    await interaction.deferReply({ ephemeral: true });

    const commitSayisi = interaction.options.getInteger('commit') || 5;
    const targetChannel = interaction.options.getChannel('kanal') || interaction.channel;

    if (!process.env.GEMINI_API_KEY) {
      return interaction.editReply({ content: '❌ Sistemde GEMINI_API_KEY bulunamadı.' });
    }

    try {
      // 1. Git loglarını al
      let gitLogs = '';
      try {
        // Sunucu ortamında (Render vb.) veya Git yüklü sistemlerde normal komut
        const { stdout } = await execPromise(`git log -n ${commitSayisi} --pretty=format:"%s"`);
        gitLogs = stdout.trim();
      } catch (cmdError) {
        // GitHub Desktop kullanan Windows kullanıcıları için manuel dosya okuma (Fallback)
        const fs = require('fs');
        const path = require('path');
        try {
          const logContent = fs.readFileSync(path.join(process.cwd(), '.git', 'logs', 'HEAD'), 'utf8');
          const lines = logContent.trim().split('\n');
          const recentLines = lines.slice(-commitSayisi);
          gitLogs = recentLines.map(line => {
            const parts = line.split('\t');
            // 'commit: Yaptığım değişiklik' veya 'commit (initial): İlk yükleme' gibi kısımları temizle
            let msg = parts.length > 1 ? parts[1] : line;
            msg = msg.replace(/^commit.*?: /, '');
            return msg;
          }).join('\n');
        } catch (fsError) {
          return interaction.editReply({ content: '❌ Git geçmişi okunamadı. (Git yüklü değil veya .git klasörü bulunamadı)' });
        }
      }

      if (!gitLogs || gitLogs.trim() === '') {
        return interaction.editReply({ content: '❌ Git geçmişinde okunacak commit bulunamadı.' });
      }

      // 2. Gemini API çağrısı yap
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });

      const prompt = `Sen "Kick AutoMod" adlı popüler ve profesyonel bir Discord/Kick moderasyon sisteminin baş geliştiricisisin. 
Aşağıda, sisteme yeni eklenen teknik kod güncellemelerinin (git log) listesi var. 
Görevin bu teknik ve sıkıcı maddeleri okuyup, sıradan Discord üyelerinin ve oyuncuların çok rahat anlayabileceği, heyecan verici, bol emojili profesyonel bir yama notuna (Patch Notes) çevirmek.
Lütfen direkt olarak mesajın kendisini yaz (başka bir açıklama yapma). 
Format şu şekilde olsun:
- Güzel bir karşılama
- Yenilikler (Maddeler halinde, basit dille, ilgili emojilerle)
- Kapanış / Teşekkür

İşte kod güncellemeleri:
${gitLogs}`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      let aiText = response.text();

      // 3. Mesajı tasarla ve kanala gönder
      const embed = new EmbedBuilder()
        .setTitle('🚀 Yeni Güncelleme Yayında! (Patch Notes)')
        .setDescription(aiText)
        .setColor(0x00FFD1) // Şık bir cyan
        .setFooter({ text: 'Kick AutoMod Geliştirici Ekibi', iconURL: this.client.user.displayAvatarURL() })
        .setTimestamp();

      await targetChannel.send({ embeds: [embed] });
      await interaction.editReply({ content: `✅ Duyuru başarıyla <#${targetChannel.id}> kanalına gönderildi!` });

    } catch (error) {
      console.error('[Discord] OtoDuyuru Hatası:', error);
      await interaction.editReply({ content: '❌ Duyuru oluşturulurken bir hata meydana geldi: ' + error.message });
    }
  }

  async stop() {
    if (this.client) {
      this.client.destroy();
      console.log('[Discord] Bot durduruldu.');
    }
  }
}

module.exports = new DiscordBot();
