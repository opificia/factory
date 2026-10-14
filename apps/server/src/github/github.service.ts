// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { Inject, Injectable } from "@nestjs/common";
import { createAppAuth } from "@octokit/auth-app";
import { App, type Octokit } from "octokit";
import { CONFIG, type Config } from "../config.js";

export type GitHubIssue = {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
};

export function splitRepo(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) throw new Error(`not a repository name: ${fullName}`);
  return { owner, repo };
}

/**
 * Talks to GitHub as the GitHub App. Tokens for git are installation tokens
 * limited to one repository; they stay in the control plane.
 */
@Injectable()
export class GitHubService {
  private readonly app: App;
  private readonly appAuth: ReturnType<typeof createAppAuth>;

  constructor(@Inject(CONFIG) config: Config) {
    this.app = new App({ appId: config.GITHUB_APP_ID, privateKey: config.githubPrivateKey });
    this.appAuth = createAppAuth({ appId: config.GITHUB_APP_ID, privateKey: config.githubPrivateKey });
  }

  async listInstallations(): Promise<Array<{ installationId: number; accountLogin: string }>> {
    const installations = await this.app.octokit.paginate("GET /app/installations", { per_page: 100 });
    return installations.map((i) => ({
      installationId: i.id,
      accountLogin: i.account && "login" in i.account ? i.account.login : String(i.id),
    }));
  }

  private octokit(installationId: number): Promise<Octokit> {
    return this.app.getInstallationOctokit(installationId);
  }

  async listRepos(installationId: number) {
    const octokit = await this.octokit(installationId);
    const repos = await octokit.paginate("GET /installation/repositories", { per_page: 100 });
    return repos.map((r) => ({
      fullName: r.full_name,
      private: r.private,
      defaultBranch: r.default_branch,
      installationId,
    }));
  }

  async getRepo(installationId: number, fullName: string): Promise<{ defaultBranch: string }> {
    const octokit = await this.octokit(installationId);
    const { data } = await octokit.rest.repos.get(splitRepo(fullName));
    return { defaultBranch: data.default_branch };
  }

  /** Open issues with the label. Pull requests are left out. */
  async listLabelledIssues(installationId: number, fullName: string, label: string): Promise<GitHubIssue[]> {
    const octokit = await this.octokit(installationId);
    const issues = await octokit.paginate("GET /repos/{owner}/{repo}/issues", {
      ...splitRepo(fullName),
      labels: label,
      state: "open",
      per_page: 100,
    });
    return issues
      .filter((i) => !i.pull_request)
      .map((i) => ({
        number: i.number,
        title: i.title,
        body: i.body ?? "",
        url: i.html_url,
        labels: i.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))),
      }));
  }

  async getIssue(installationId: number, fullName: string, number: number): Promise<GitHubIssue> {
    const octokit = await this.octokit(installationId);
    const { data } = await octokit.rest.issues.get({ ...splitRepo(fullName), issue_number: number });
    return {
      number: data.number,
      title: data.title,
      body: data.body ?? "",
      url: data.html_url,
      labels: data.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))),
    };
  }

  async comment(installationId: number, fullName: string, number: number, body: string): Promise<void> {
    const octokit = await this.octokit(installationId);
    await octokit.rest.issues.createComment({ ...splitRepo(fullName), issue_number: number, body });
  }

  async openPullRequest(
    installationId: number,
    fullName: string,
    input: { title: string; body: string; head: string; base: string },
  ): Promise<{ url: string; number: number }> {
    const octokit = await this.octokit(installationId);
    const { data } = await octokit.rest.pulls.create({ ...splitRepo(fullName), ...input });
    return { url: data.html_url, number: data.number };
  }

  /** An installation token that can only reach one repository. */
  async repoToken(installationId: number, fullName: string, write: boolean): Promise<string> {
    const { repo } = splitRepo(fullName);
    const { token } = await this.appAuth({
      type: "installation",
      installationId,
      repositoryNames: [repo],
      permissions: write ? { contents: "write" } : { contents: "read" },
    });
    return token;
  }
}
