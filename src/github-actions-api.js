/**
 * Checks the latest workflow run and triggers the workflow unless it failed.
 *
 * @param {Object} options
 * @param {string} options.token        GitHub Personal Access Token
 * @param {string} options.owner        Repository owner
 * @param {string} options.repo         Repository name
 * @param {string|number} options.workflowId  Workflow file name or ID (e.g. "ci.yml")
 * @param {string} [options.ref="main"] Git ref to run the workflow on
 */
export async function triggerWorkflowUnlessFailed({
  token,
  owner,
  repo,
  workflowId,
  ref = "main",
}) {
  const baseUrl = "https://api.github.com";
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "fx-status-checker",
  };
  // 1. Fetch the most recent workflow run
  const runsRes = await fetch(
    `${baseUrl}/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs?per_page=1`,
    { headers }
  );

  if (!runsRes.ok) {
    throw new Error(`Failed to fetch workflow runs: ${runsRes.status}`);
  }

  const runsData = await runsRes.json();
  const latestRun = runsData.workflow_runs?.[0];

  if (latestRun) {
    const { status, conclusion } = latestRun;

    console.log("Latest run:", {
      status,
      conclusion,
      html_url: latestRun.html_url,
    });

    // 2. Do not trigger if the most recent run failed
    if (conclusion !== "success") {
      console.log("Latest workflow run failed — not triggering.");
      return { triggered: false, reason: "latest_run_failed" };
    }
  } else {
    console.log("No previous workflow runs found.");
  }

  // 3. Trigger the workflow
  const dispatchRes = await fetch(
    `${baseUrl}/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ ref }),
    }
  );

  if (!dispatchRes.ok) {
    throw new Error(`Failed to trigger workflow: ${dispatchRes.status}`);
  }

  console.log("Workflow triggered successfully.");
  return { triggered: true };
}
