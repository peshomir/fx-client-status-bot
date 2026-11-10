import { triggerWorkflowUnlessFailed } from "./github-actions-api"
import ModUtils, { minifyCode, tryParseGameVersion } from "../FXclient/modUtils.js"

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

/**
 * Reads the version out of the game script embedded in Territorial.io's HTML.
 * @param {string?} html
 * @returns {{ game: string, protocol: string } | null}
 */
export function parseVanillaVersion(html) {
  if (!html) return null
  for (const [, script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    try {
      const version = tryParseGameVersion(new ModUtils(minifyCode(script)))
      if (version) return version
    } catch (e) {
      console.debug("Skipping script that failed to parse:", e)
    }
  }
  return null
}

/**
 * Parses FX Client's version.txt, formatted as `<game> <protocol>` (e.g. "2.17.7 1772").
 * @param {string?} text
 * @returns {{ game: string, protocol: string } | null}
 */
export function parseVersionFile(text) {
  if (!text) return null
  const [game, protocol] = text.trim().split(/\s+/)
  if (!game || !protocol || game === "unknown") return null
  return { game, protocol }
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
      const vanillaVersion = parseVanillaVersion(
        await tryFetchTextContent(env.territorialURL ?? "https://territorial.io"),
      )
      const fxVersion = parseVersionFile(
        await tryFetchTextContent("https://fxclient.github.io/FXclient/version.txt"),
      )
      const isLocalDevEnv = env.isDevEnv === "true"
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
        const customLobbyEmoji = !customLobbyProtocolVersion ? (isLocalDevEnv ? "🔳" : "🟥") : "🟩"
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
              ? `\n-# Version: ${fxVersion.game}`
              : `\n-# New version: ${vanillaVersion?.game} | FX version: ${fxVersion?.game}`),
        "Custom lobby server": !customLobbyProtocolVersion
          ? isLocalDevEnv
            ? "🔳 Not applicable\n-# (status checker executed in a local development environment used for testing)"
            : "⭕ Offline / Unknown status (possibly went over the free tier limits)"
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
