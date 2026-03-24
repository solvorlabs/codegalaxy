import { Octokit } from "@octokit/rest"

export function createOctokit(token) {
  return new Octokit({ auth: token })
}

export async function getRepoTree(octokit, owner, repo) {
  const { data: repoData } = await octokit.rest.repos.get({ owner, repo })
  const branch = repoData.default_branch

  const { data } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: branch,
    recursive: "1",
  })
  return data.tree
}

export async function getFileContent(octokit, owner, repo, path) {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path })
    if (data.encoding === "base64") {
      return Buffer.from(data.content, "base64").toString("utf-8")
    }
    return null
  } catch {
    return null
  }
}

export async function getUserRepos(octokit) {
  const { data } = await octokit.rest.repos.listForAuthenticatedUser({
    sort: "updated",
    per_page: 30,
  })
  return data
}
