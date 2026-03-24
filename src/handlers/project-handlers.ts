import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BitbucketApiClient } from '../utils/api-client.js';
import {
  isListProjectsArgs,
  isListRepositoriesArgs,
  isCreateRepositoryArgs,
  isGetRepositoryArgs,
  isUpdateRepositoryArgs,
  isDeleteRepositoryArgs,
  isCreateBranchArgs
} from '../types/guards.js';
import {
  BitbucketServerProject,
  BitbucketCloudProject,
  BitbucketServerRepository,
  BitbucketCloudRepository
} from '../types/bitbucket.js';

export class ProjectHandlers {
  constructor(
    private apiClient: BitbucketApiClient,
    private baseUrl: string
  ) {}

  async handleListProjects(args: any) {
    if (!isListProjectsArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for list_projects'
      );
    }

    const { name, permission, limit = 25, start = 0 } = args;

    try {
      let apiPath: string;
      let params: any = {};
      let projects: any[] = [];
      let totalCount = 0;
      let nextPageStart: number | null = null;

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server API
        apiPath = `/rest/api/1.0/projects`;
        params = {
          limit,
          start
        };

        if (name) {
          params.name = name;
        }
        if (permission) {
          params.permission = permission;
        }

        const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, { params });

        // Format projects
        projects = (response.values || []).map((project: BitbucketServerProject) => ({
          key: project.key,
          name: project.name,
          description: project.description || '',
          type: project.type,
          url: `${this.baseUrl}/projects/${project.key}`
        }));

        totalCount = response.size || projects.length;
        if (!response.isLastPage && response.nextPageStart !== undefined) {
          nextPageStart = response.nextPageStart;
        }
      } else {
        // Bitbucket Cloud API
        apiPath = `/workspaces`;
        params = {
          pagelen: limit,
          page: Math.floor(start / limit) + 1
        };

        // Cloud uses workspaces, not projects exactly
        const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, { params });

        projects = (response.values || []).map((workspace: any) => ({
          key: workspace.slug,
          name: workspace.name,
          description: '',
          type: 'WORKSPACE',
          url: workspace.links.html.href
        }));

        totalCount = response.size || projects.length;
        if (response.next) {
          nextPageStart = start + limit;
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              projects,
              total_count: totalCount,
              start,
              limit,
              has_more: nextPageStart !== null,
              next_start: nextPageStart
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.apiClient.handleApiError(error, 'listing projects');
    }
  }

  async handleListRepositories(args: any) {
    if (!isListRepositoriesArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for list_repositories'
      );
    }

    const { workspace, name, permission, limit = 25, start = 0 } = args;

    try {
      let apiPath: string;
      let params: any = {};
      let repositories: any[] = [];
      let totalCount = 0;
      let nextPageStart: number | null = null;

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server API
        if (workspace) {
          // List repos in a specific project
          apiPath = `/rest/api/1.0/projects/${workspace}/repos`;
        } else {
          // List all accessible repos
          apiPath = `/rest/api/1.0/repos`;
        }

        params = {
          limit,
          start
        };

        if (name) {
          params.name = name;
        }
        if (permission) {
          params.permission = permission;
        }
        if (!workspace && name) {
          // When listing all repos and filtering by name
          params.projectname = name;
        }

        const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, { params });

        // Format repositories
        repositories = (response.values || []).map((repo: BitbucketServerRepository) => ({
          slug: repo.slug,
          name: repo.name,
          description: repo.description || '',
          project_key: repo.project.key,
          project_name: repo.project.name,
          is_public: repo.public,
          url: `${this.baseUrl}/projects/${repo.project.key}/repos/${repo.slug}`
        }));

        totalCount = response.size || repositories.length;
        if (!response.isLastPage && response.nextPageStart !== undefined) {
          nextPageStart = response.nextPageStart;
        }
      } else {
        // Bitbucket Cloud API
        if (workspace) {
          // List repos in a specific workspace
          apiPath = `/repositories/${workspace}`;
        } else {
          // Cloud doesn't support listing all repos without workspace
          // We'll return an error message
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Bitbucket Cloud requires a workspace parameter to list repositories. Please provide a workspace.'
                }, null, 2),
              },
            ],
            isError: true,
          };
        }

        params = {
          pagelen: limit,
          page: Math.floor(start / limit) + 1
        };

        const response = await this.apiClient.makeRequest<any>('get', apiPath, undefined, { params });

        repositories = (response.values || []).map((repo: BitbucketCloudRepository) => ({
          slug: repo.slug,
          name: repo.name,
          description: repo.description || '',
          project_key: repo.project?.key || '',
          project_name: repo.project?.name || '',
          is_public: !repo.is_private,
          url: repo.links.html.href
        }));

        totalCount = response.size || repositories.length;
        if (response.next) {
          nextPageStart = start + limit;
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              repositories,
              total_count: totalCount,
              start,
              limit,
              has_more: nextPageStart !== null,
              next_start: nextPageStart,
              workspace: workspace || 'all'
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.apiClient.handleApiError(error, workspace ? `listing repositories in ${workspace}` : 'listing repositories');
    }
  }

  async handleCreateRepository(args: any) {
    if (!isCreateRepositoryArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for create_repository — workspace and repository (slug) are required'
      );
    }

    const { workspace, repository, description, is_private = true, project_key, default_branch, has_issues, has_wiki } = args;

    try {
      let result: any;

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server: POST /rest/api/1.0/projects/{key}/repos
        const body: any = {
          name: repository,
          scmId: 'git',
        };
        if (description) body.description = description;
        if (default_branch) body.defaultBranch = default_branch;
        // Server repos in a project are not individually public/private — project controls that

        result = await this.apiClient.makeRequest<any>(
          'post',
          `/rest/api/1.0/projects/${workspace}/repos`,
          body
        );

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              slug: result.slug,
              name: result.name,
              description: result.description || '',
              project_key: result.project?.key,
              state: result.state,
              url: `${this.baseUrl}/projects/${result.project?.key}/repos/${result.slug}`,
              clone_urls: (result.links?.clone || []).map((c: any) => ({ name: c.name, href: c.href })),
            }, null, 2),
          }],
        };
      } else {
        // Bitbucket Cloud: POST /repositories/{workspace}/{slug}
        const body: any = {
          scm: 'git',
          is_private: is_private,
        };
        if (description) body.description = description;
        if (project_key) body.project = { key: project_key };
        if (has_issues !== undefined) body.has_issues = has_issues;
        if (has_wiki !== undefined) body.has_wiki = has_wiki;
        if (default_branch) body.mainbranch = { type: 'branch', name: default_branch };

        result = await this.apiClient.makeRequest<any>(
          'post',
          `/repositories/${workspace}/${repository}`,
          body
        );

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              slug: result.slug,
              name: result.name,
              full_name: result.full_name,
              description: result.description || '',
              is_private: result.is_private,
              project_key: result.project?.key || '',
              url: result.links?.html?.href || '',
              clone_urls: (result.links?.clone || []).map((c: any) => ({ name: c.name, href: c.href })),
            }, null, 2),
          }],
        };
      }
    } catch (error) {
      return this.apiClient.handleApiError(error, `creating repository ${workspace}/${repository}`);
    }
  }

  async handleGetRepository(args: any) {
    if (!isGetRepositoryArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for get_repository — workspace and repository are required'
      );
    }

    const { workspace, repository } = args;

    try {
      let result: any;

      if (this.apiClient.getIsServer()) {
        result = await this.apiClient.makeRequest<any>(
          'get',
          `/rest/api/1.0/projects/${workspace}/repos/${repository}`
        );

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              slug: result.slug,
              name: result.name,
              description: result.description || '',
              project_key: result.project?.key,
              project_name: result.project?.name,
              state: result.state,
              is_public: result.public,
              forkable: result.forkable,
              scm: result.scmId,
              url: `${this.baseUrl}/projects/${result.project?.key}/repos/${result.slug}`,
              clone_urls: (result.links?.clone || []).map((c: any) => ({ name: c.name, href: c.href })),
            }, null, 2),
          }],
        };
      } else {
        result = await this.apiClient.makeRequest<any>(
          'get',
          `/repositories/${workspace}/${repository}`
        );

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              slug: result.slug,
              name: result.name,
              full_name: result.full_name,
              description: result.description || '',
              is_private: result.is_private,
              project_key: result.project?.key || '',
              project_name: result.project?.name || '',
              language: result.language || '',
              size: result.size,
              default_branch: result.mainbranch?.name || '',
              created_on: result.created_on,
              updated_on: result.updated_on,
              has_issues: result.has_issues,
              has_wiki: result.has_wiki,
              url: result.links?.html?.href || '',
              clone_urls: (result.links?.clone || []).map((c: any) => ({ name: c.name, href: c.href })),
            }, null, 2),
          }],
        };
      }
    } catch (error) {
      return this.apiClient.handleApiError(error, `getting repository ${workspace}/${repository}`);
    }
  }

  async handleUpdateRepository(args: any) {
    if (!isUpdateRepositoryArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for update_repository — workspace and repository are required'
      );
    }

    const { workspace, repository, description, is_private, project_key, default_branch, has_issues, has_wiki } = args;

    try {
      let result: any;

      if (this.apiClient.getIsServer()) {
        const body: any = {};
        if (description !== undefined) body.description = description;
        if (default_branch) body.defaultBranch = default_branch;

        result = await this.apiClient.makeRequest<any>(
          'put',
          `/rest/api/1.0/projects/${workspace}/repos/${repository}`,
          body
        );

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              slug: result.slug,
              name: result.name,
              description: result.description || '',
              project_key: result.project?.key,
              state: result.state,
              url: `${this.baseUrl}/projects/${result.project?.key}/repos/${result.slug}`,
              message: 'Repository updated successfully',
            }, null, 2),
          }],
        };
      } else {
        const body: any = {};
        if (description !== undefined) body.description = description;
        if (is_private !== undefined) body.is_private = is_private;
        if (project_key) body.project = { key: project_key };
        if (default_branch) body.mainbranch = { type: 'branch', name: default_branch };
        if (has_issues !== undefined) body.has_issues = has_issues;
        if (has_wiki !== undefined) body.has_wiki = has_wiki;

        result = await this.apiClient.makeRequest<any>(
          'put',
          `/repositories/${workspace}/${repository}`,
          body
        );

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              slug: result.slug,
              name: result.name,
              full_name: result.full_name,
              description: result.description || '',
              is_private: result.is_private,
              project_key: result.project?.key || '',
              url: result.links?.html?.href || '',
              message: 'Repository updated successfully',
            }, null, 2),
          }],
        };
      }
    } catch (error) {
      return this.apiClient.handleApiError(error, `updating repository ${workspace}/${repository}`);
    }
  }

  async handleDeleteRepository(args: any) {
    if (!isDeleteRepositoryArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for delete_repository — workspace and repository are required'
      );
    }

    const { workspace, repository, confirm } = args;

    if (!confirm) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Deleting repository '${workspace}/${repository}' is a destructive action that cannot be undone. Please set confirm: true to proceed.`,
          }, null, 2),
        }],
        isError: true,
      };
    }

    try {
      if (this.apiClient.getIsServer()) {
        await this.apiClient.makeRequest<any>(
          'delete',
          `/rest/api/1.0/projects/${workspace}/repos/${repository}`
        );
      } else {
        await this.apiClient.makeRequest<any>(
          'delete',
          `/repositories/${workspace}/${repository}`
        );
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: `Repository ${workspace}/${repository} deleted successfully`,
          }, null, 2),
        }],
      };
    } catch (error) {
      return this.apiClient.handleApiError(error, `deleting repository ${workspace}/${repository}`);
    }
  }

  async handleCreateBranch(args: any) {
    if (!isCreateBranchArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments for create_branch — workspace, repository, and branch_name are required'
      );
    }

    const { workspace, repository, branch_name, source } = args;

    try {
      let result: any;

      if (this.apiClient.getIsServer()) {
        // Bitbucket Server: POST /rest/branch-utils/latest/projects/{key}/repos/{slug}/branches
        let startPoint = source;
        if (!startPoint) {
          try {
            const repoInfo = await this.apiClient.makeRequest<any>(
              'get',
              `/rest/api/1.0/projects/${workspace}/repos/${repository}/default-branch`
            );
            startPoint = repoInfo.id || 'refs/heads/main';  // e.g. "refs/heads/master"
          } catch {
            startPoint = 'refs/heads/main';
          }
        }

        const body: any = {
          name: branch_name,
          startPoint,
        };

        result = await this.apiClient.makeRequest<any>(
          'post',
          `/rest/branch-utils/latest/projects/${workspace}/repos/${repository}/branches`,
          body
        );

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              name: result.displayId || branch_name,
              id: result.id,
              latest_commit: result.latestCommit,
              url: `${this.baseUrl}/projects/${workspace}/repos/${repository}/browse?at=${encodeURIComponent(result.id || branch_name)}`,
              message: `Branch '${branch_name}' created successfully`,
            }, null, 2),
          }],
        };
      } else {
        // Bitbucket Cloud: POST /repositories/{workspace}/{slug}/refs/branches
        // Cloud API expects target.hash to be a commit SHA, not a branch name
        let targetHash = source || 'main';
        if (targetHash && !/^[0-9a-f]{40}$/i.test(targetHash)) {
          // It's a branch name, resolve to hash
          try {
            const branchInfo = await this.apiClient.makeRequest<any>(
              'get',
              `/repositories/${workspace}/${repository}/refs/branches/${encodeURIComponent(targetHash)}`
            );
            targetHash = branchInfo.target?.hash || targetHash;
          } catch {
            // If branch lookup fails, try using the name directly (API might accept it)
          }
        }

        const body: any = {
          name: branch_name,
          target: {
            hash: targetHash,
          },
        };

        result = await this.apiClient.makeRequest<any>(
          'post',
          `/repositories/${workspace}/${repository}/refs/branches`,
          body
        );

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              name: result.name,
              target_hash: result.target?.hash,
              url: result.links?.html?.href || '',
              message: `Branch '${branch_name}' created successfully`,
            }, null, 2),
          }],
        };
      }
    } catch (error) {
      return this.apiClient.handleApiError(error, `creating branch '${branch_name}' in ${workspace}/${repository}`);
    }
  }
}
