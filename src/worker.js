import { triggerWorkflowUnlessFailed } from "./github-actions-api"

/** @param {string?} code */
function tryParseVersion(code) {
  if (code === null) return null
  code = code.replace(/\r?\n|\r/g, "")
  console.debug("Code start: ", code.slice(0, 100), "\nCode end: ", code.slice(-100))
  const expressionForOriginalCode =
    /\{this\.\w+=(\d+);var \w+=(\d+);var \w+=(\d+);var \w+=(\d+);this\.\w+=\d+;this\.\w+=\d+;this\.\w+=function\(\)\{/g
  const expressionForFXCode =
    /\{\tthis\.\w+ = (\d+);[\s\S]+?this\.\w+ = "(\d+)\.(\d+)\.(\d+)", this.(\w+) =/g
  const result = expressionForOriginalCode.exec(code) ?? expressionForFXCode.exec(code)
  if (result === null) return null
  const [_match, protocolVersion, majorGameVersion, minorGameVersion, patchGameVersion] = result
  const gameVersion = parseInt([majorGameVersion, minorGameVersion, patchGameVersion].join(""))
  return { protocol: protocolVersion, game: gameVersion }
}
/** @param {number} [version]  */
function formatVersion(version) {
  if (version === undefined) return "Unknown"
  const str = version.toString()
  if (str.length !== 4) return str
  const [a, b, c, d] = str
  return `${a}.${b}${c}.${d}`
}
async function tryFetchTextContent(/** @type {string} */ url) {
  try {
    const response = await fetch(url)
    if (response.ok) return await response.text()
    console.log("Fetch failed: ", url, response.status, response.statusText)
    return null
  } catch (e) {
    console.log("Fetch error: ", url, e)
    return null
  }
}

export default {
  async fetch(request, env, ctx) {
    return new Response("ok")
  },
  async scheduled(event, env, ctx) {
    const { statusChannel, statusMessage, notificationChannel, token } = env
    const storage = env.KV_STATUS

    /**
     * @param {string} path
     * @param {any} data
     */
    async function sendDiscordAPIRequest(path, method = "GET", data) {
      const requestResponse = await fetch(`https://discord.com/api/v10/${path}`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bot ${token}`,
        },
        method: method,
        body: data !== undefined ? JSON.stringify(data) : undefined,
      })
      const response = await requestResponse.json()
      if (response.errors !== undefined) throw new Error(response)
      return response
    }

    // to create a new message
    /*return await sendDiscordAPIRequest(`channels/${statusChannel}/messages`, 'POST', {
      embeds: [{ description: "This is an embed" }]
    })*/

    async function sendNotification(/** @type {string} */ message) {
      const data = {
        content: "[Status checker] " + message,
      }
      await sendDiscordAPIRequest(`channels/${notificationChannel}/messages`, "POST", data)
    }
    async function updateStatus(status = {}, embedColor = 0x000000) {
      const fields = Object.entries(status).map(([name, value]) => ({ name, value }))

      const message = {
        embeds: [
          {
            title: "FX Client Status",
            fields,
            color: embedColor,
            footer: { text: "Last checked" },
            timestamp: new Date().toISOString(),
          },
        ],
      }
      const path = `channels/${statusChannel}/messages/${statusMessage}`
      await sendDiscordAPIRequest(path, "PATCH", message)
      // also maybe change the status channel's name to include an emoji
    }

    try {
      const vanillaVersion = tryParseVersion(await tryFetchTextContent("https://territorial.io"))
      const fxVersion = tryParseVersion(
        await tryFetchTextContent("https://fxclient.github.io/FXclient/game.js"),
      )
      try {
        var customLobbyProtocolVersion = (
          await env.CUSTOM_LOBBIES.getProtocolVersionAndVerifyStatus(undefined)
        ).toString()
      } catch (error) {
        console.log(error)
        var customLobbyProtocolVersion = null
      }

      const newVersionInfo = {
        vanilla: vanillaVersion,
        fx: fxVersion,
        customLobby: customLobbyProtocolVersion,
      }

      const storedVersionInfoStr = await storage.get("versionInfo")
      let storedVersionInfo
      try {
        storedVersionInfo = storedVersionInfoStr ? JSON.parse(storedVersionInfoStr) : null
      } catch (e) {
        storedVersionInfo = null
      }

      const parsingFailed = !vanillaVersion || !fxVersion
      const gameVersionsMatch = !parsingFailed && vanillaVersion?.game === fxVersion?.game
      const protocolVersionsMatch =
        !parsingFailed && vanillaVersion?.protocol === fxVersion?.protocol

      const newInfoString = JSON.stringify(newVersionInfo)
      if (!storedVersionInfo || JSON.stringify(storedVersionInfo) !== newInfoString) {
        const emoji = parsingFailed
          ? "⭕"
          : gameVersionsMatch
            ? "🟢"
            : protocolVersionsMatch
              ? "🟡"
              : "🟠"
        const customLobbyEmoji = !customLobbyProtocolVersion ? "🟥" : "🟩"
        await sendNotification(`${emoji}/${customLobbyEmoji} Version changed: ${newInfoString}`)
        await storage.put("versionInfo", newInfoString)
      }
      if (!parsingFailed && !gameVersionsMatch) {
        const { triggered } = await triggerWorkflowUnlessFailed({
          owner: "fxclient",
          repo: "FXclient",
          token: env.githubActionsToken,
          workflowId: "deploy_github_pages.yml",
        })
        if (!triggered && (await storage.get("needsManualUpdate")) === "false")
          await sendNotification(`<@&1055887031949070476> Workflow run failed`)
        await storage.put("needsManualUpdate", JSON.stringify(!triggered))
      }

      const status = {
        Client: parsingFailed
          ? "⭕ Unknown (Failed to parse version)"
          : (gameVersionsMatch && protocolVersionsMatch
              ? "🟢 Up to date"
              : protocolVersionsMatch
                ? "🟡 Outdated, usable for multiplayer"
                : "🟠 Outdated") +
            (gameVersionsMatch
              ? `\n-# Version: ${formatVersion(fxVersion.game)}`
              : `\n-# New version: ${formatVersion(
                  vanillaVersion?.game,
                )} | FX version: ${formatVersion(fxVersion?.game)}`),
        "Custom lobby server": !customLobbyProtocolVersion
          ? "⭕ Offline / Unknown status (possibly went over the free tier limits)"
          : customLobbyProtocolVersion === vanillaVersion?.protocol
            ? "✅ Up to date"
            : customLobbyProtocolVersion === fxVersion?.protocol
              ? "✅ Up to date with FX Client"
              : "🟩 Online\n-# Compatibility with latest version not verified",
      }

      const GREEN = 0x78b159
      const ORANGE = 0xf4900c

      await updateStatus(status, gameVersionsMatch ? GREEN : ORANGE)
    } catch (e) {
      console.log(e)
      await sendNotification("Error\n" + e)
    }
  },
}
