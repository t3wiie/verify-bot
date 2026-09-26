const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const http = require('http');
const fs = require('fs');

// ===== CONFIG =====
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const PORT = process.env.PORT || 3000;
// ==========================

const DATA_FILE = "./data.json";
let codes = {};
let users = {};
let banned = [];
try { const d = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); codes = d.codes || {}; users = d.users || {}; banned = d.banned || []; } catch {}
const save = () => { try { fs.writeFileSync(DATA_FILE, JSON.stringify({ codes, users, banned })); } catch {} };

const code5 = () => { const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = ""; for (let i = 0; i < 5; i++) s += c[Math.floor(Math.random() * c.length)]; return s; };

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration] });

client.once('ready', async () => {
  console.log(`Bot conectado como ${client.user.tag}`);

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const bans = await guild.bans.fetch();
    for (const [, info] of bans) {
      const uname = info.user.username.toLowerCase();
      if (!banned.includes(uname)) banned.push(uname);
    }
    save();
    console.log(`Sincronizados ${bans.size} baneos del servidor.`);
  } catch (e) { console.error('No se pudieron sincronizar baneos:', e.message); }

  const verifyCmd = new SlashCommandBuilder().setName('verify').setDescription('Genera un codigo para verificar tu cuenta en el juego');
  const banCmd = new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Banea a un usuario del juego (solo admins)')
    .addUserOption(o => o.setName('usuario').setDescription('Usuario de Discord a banear').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);
  const unbanCmd = new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Desbanea a un usuario del juego (solo admins)')
    .addUserOption(o => o.setName('usuario').setDescription('Usuario de Discord a desbanear').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [verifyCmd.toJSON(), banCmd.toJSON(), unbanCmd.toJSON()] });
    console.log('Comandos /verify, /ban y /unban registrados.');
  } catch (e) { console.error('Error registrando comandos:', e.message); }
});

client.on('guildBanAdd', async (ban) => {
  if (ban.guild.id !== GUILD_ID) return;
  const uname = ban.user.username.toLowerCase();
  if (!banned.includes(uname)) banned.push(uname);
  save();
  console.log(`@${uname} baneado automaticamente del juego (baneado del server).`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'verify') {
    const uname = interaction.user.username.toLowerCase();
    if (banned.includes(uname)) {
      return interaction.reply({ content: "Estas baneado y no puedes verificarte.", flags: MessageFlags.Ephemeral });
    }
    const code = code5();
    codes[code] = {
      name: uname,
      display: (interaction.user.globalName || interaction.user.username).toLowerCase(),
      expires: Date.now() + 15 * 60 * 1000,
    };
    save();
    await interaction.reply({
      content: `Tu codigo es: **${code}**\nEscribelo en el juego.\n(Expira en 15 minutos)`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.commandName === 'ban') {
    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.BanMembers)) {
      return interaction.reply({ content: "No tienes permiso para banear.", flags: MessageFlags.Ephemeral });
    }
    const target = interaction.options.getUser('usuario');
    const uname = target.username.toLowerCase();
    if (!banned.includes(uname)) banned.push(uname);
    save();
    return interaction.reply({ content: `**@${uname}** ha sido baneado del juego.`, flags: MessageFlags.Ephemeral });
  }

  if (interaction.commandName === 'unban') {
    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.BanMembers)) {
      return interaction.reply({ content: "No tienes permiso para desbanear.", flags: MessageFlags.Ephemeral });
    }
    const target = interaction.options.getUser('usuario');
    const uname = target.username.toLowerCase();
    banned = banned.filter(n => n !== uname);
    save();
    return interaction.reply({ content: `**@${uname}** ha sido desbaneado del juego.`, flags: MessageFlags.Ephemeral });
  }
});

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const u = new URL(req.url, 'http://localhost');
  const send = (o, c = 200) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };

  if (u.pathname === '/verify-code') {
    const code = (u.searchParams.get('code') || '').toUpperCase().trim();
    const e = codes[code];
    if (!e) return send({ ok: false, err: 'codigo invalido' });
    if (Date.now() > e.expires) { delete codes[code]; save(); return send({ ok: false, err: 'codigo expirado' }); }
    if (banned.includes(e.name)) { delete codes[code]; save(); return send({ ok: false, err: 'banned' }); }
    delete codes[code]; save();
    return send({ ok: true, discord: e.name });
  }
  if (u.pathname === '/profile' && req.method === 'POST') {
    let b = ''; req.on('data', (c) => b += c);
    req.on('end', () => { try { const d = JSON.parse(b); users[String(d.userId)] = { discord: d.discord, age: d.age, gender: d.gender, preference: d.preference, verified: true }; save(); send({ ok: true }); } catch (e) { send({ ok: false, err: String(e) }, 400); } });
    return;
  }
  if (u.pathname.startsWith('/user/')) return send(users[u.pathname.split('/').pop()] || { verified: false });
  send({ ok: true, service: 'roblox-verify-bot' });
}).listen(PORT, () => console.log(`Servidor local en http://localhost:${PORT}`));

console.log("TOKEN check:", TOKEN ? ("empieza con " + TOKEN.substring(0, 6) + " y mide " + TOKEN.length) : "VACIO/UNDEFINED");
console.log("CLIENT_ID:", CLIENT_ID, "| GUILD_ID:", GUILD_ID);
client.login(TOKEN).then(() => console.log("Login OK")).catch(err => console.error('LOGIN ERROR:', err.message));
