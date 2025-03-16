/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run "npm run dev" in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run "npm run deploy" to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

const GREEN = 0x66bb6a;
const RED = 0xef5250;
const YELLOW = 0xff8d01;

/** @param {string} code */
function tryParseVersion(code) {
  code = code.replace(/\n/g, "");
  const expressionForOriginalCode = /\{this\.\w+=(\d+);this\.\w+=([1-9]\d+);this\.\w+=\d+;this\.\w+=function\(\)\{/g;
  //const expressionForMinifiedCode = /\{this\.\w+=(\d+),this\.\w+=([1-9]\d+),this\.\w+=\d+,this\.\w+=function\(\)\{/g
  const expressionForFXCode = /\tthis\.\w+ = (\d+), this\.\w+ = ([1-9]\d+), this\.\w+ = \d+, this\.\w+ = function\(\) \{/g
  const result = expressionForOriginalCode.exec(code) ?? expressionForFXCode.exec(code);
  if (result === null) return null;
  const [ _match, protocolVersion, gameVersion ] = result;
  return { protocolVersion, gameVersion };
}

export default {
  async fetch(request, env, ctx) {
    return new Response("ok");
  },
  async scheduled(event, env, ctx) {
    const { statusChannel, statusMessage, notificationChannel, token } = env;

    /**
     * @param {string} path
     * @param {string} method
     * @param {any} data
     */
    async function sendDiscordAPIRequest(path, method, data) {
      const requestResponse = await fetch(`https://discord.com/api/v10/${path}`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bot ${token}`,
        },
        method: method,
        body: data !== undefined ? JSON.stringify(data) : undefined,
      });
      const response = await requestResponse.json();
      console.log(response);
      return response;
    }

    // to create a new message
    /*return await sendDiscordAPIRequest(`channels/${statusChannel}/messages`, 'POST', {
      embeds: [{ description: "This is an embed" }]
    })*/

    async function sendNotification(/** @type {string} */ message) {
      const data = {
        content: "[Status checker] " + message
      }
      await sendDiscordAPIRequest(`channels/${notificationChannel}/messages`, 'POST', data);
    }
    async function updateStatus(status = "Unknown", embedColor = 0x000000, emoji = "⚫") {
      const path = `channels/${statusChannel}/messages/${statusMessage}`;
      const oldMessage = await sendDiscordAPIRequest(path, 'GET');
      const oldEmbed = oldMessage.embeds[0];
      console.log(oldEmbed);

      if (!oldEmbed.description.startsWith(emoji)) {
        // status changed
        await sendNotification(`Status changed\nOld status: ${oldEmbed.description}\nNew status: ${emoji} ${status}`);
      }

      const message = {
        embeds: [{
          title: "FX Client Status",
          description: emoji + " " + status,
          color: embedColor,
          footer: { text: "Last checked" },
          timestamp: (new Date()).toISOString()
        }]
      };
      const response = await sendDiscordAPIRequest(path, 'PATCH', message)
      console.log(response);
      // also maybe change channel name to include the emoji
    }

    const vanillaVersion = tryParseVersion(await (await fetch("https://territorial.io")).text());
    const fxVersion = tryParseVersion(await (await fetch("https://fxclient.github.io/FXclient/game.js")).text());

    if (!vanillaVersion || !fxVersion) {
      await sendNotification(`Failed to parse version
Vanilla game version: ${vanillaVersion?.gameVersion} | Protocol version: ${vanillaVersion?.protocolVersion}
FX game version: ${fxVersion?.gameVersion} | Protocol version: ${fxVersion?.protocolVersion}`);
      await updateStatus("Unknown (Failed to parse version)", RED, "⭕");
      console.log(`Vanilla version: ${vanillaVersion}\nFX version: ${fxVersion}`);
    } else if (vanillaVersion.gameVersion === fxVersion.gameVersion) {
      await updateStatus(`Up to date\n\nVersion: ${fxVersion.gameVersion}`, GREEN, "🟢");
    } else if (vanillaVersion.protocolVersion !== fxVersion.protocolVersion) {
      //await sendNotification(`Client outdated`);
      await updateStatus(`Outdated\n\nNew version: ${vanillaVersion.gameVersion}\nFX version: ${fxVersion.gameVersion}`, YELLOW, "🟠");
    } else if (vanillaVersion.gameVersion !== fxVersion.gameVersion) {
      //await sendNotification(`Client outdated; protocol version is the same`);
      await updateStatus(`Outdated, usable for multiplayer\n\nNew version: ${vanillaVersion.gameVersion}\nFX version: ${fxVersion.gameVersion}`, YELLOW, "🟡");
    } else {
      await sendNotification(`Default case
Vanilla game version: ${vanillaVersion?.gameVersion} | Protocol version: ${vanillaVersion?.protocolVersion}
FX game version: ${fxVersion?.gameVersion} | Protocol version: ${fxVersion?.protocolVersion}`);
    }
  }
};