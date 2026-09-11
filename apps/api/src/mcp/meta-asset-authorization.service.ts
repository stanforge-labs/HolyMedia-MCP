import type { DatabaseService } from "../infrastructure/database.service.js";
import type { ProviderService } from "../providers/provider.service.js";
import type { ServiceTokenPrincipal } from "../service-tokens/service-token.service.js";
import { MetaReadError, metaReadError } from "../providers/meta-read.error.js";

export const META_ASSET_TOOLS = new Set([
  "list_meta_pages",
  "get_meta_page",
  "list_page_posts",
  "get_page_post",
  "get_page_post_engagement",
  "get_page_instagram_account",
  "list_meta_businesses",
  "get_meta_business",
  "list_business_pages",
  "list_business_ad_accounts",
]);

/** Ad-account restrictions select an authorized connection, never authorize a Page ID.
 * Non-ad assets are verified against that connection's current credential. No global cache.
 */
export class MetaAssetAuthorizationService {
  public constructor(
    private readonly db: DatabaseService,
    private readonly providers: ProviderService,
  ) {}

  public async context(
    principal: ServiceTokenPrincipal,
    args: Record<string, unknown>,
    operation: string,
  ) {
    const raw = args.account_id ?? args.accountId;
    if (
      raw !== undefined &&
      (typeof raw !== "string" || !/^(act_)?\d{1,40}$/.test(raw))
    )
      throw new MetaReadError("meta_invalid_parameters", operation);
    const accounts = await this.db.client.providerAccount.findMany({
      where: {
        workspaceId: principal.workspaceId,
        provider: "META_ADS",
        enabled: true,
        connection: {
          workspaceId: principal.workspaceId,
          status: { in: ["CONNECTED", "DEGRADED"] },
        },
        ...(principal.accountIds.length
          ? { id: { in: principal.accountIds } }
          : {}),
      },
      select: { id: true, connectionId: true, externalAccountId: true },
    });
    const selected = raw
      ? accounts.filter(
          (a) =>
            a.externalAccountId.replace(/^act_/, "") ===
            raw.replace(/^act_/, ""),
        )
      : accounts;
    if (!selected.length)
      throw new MetaReadError("meta_connection_required", operation);
    const connections = new Set(selected.map((a) => a.connectionId));
    if (connections.size !== 1)
      throw new MetaReadError("meta_connection_ambiguous", operation);
    const account = selected[0]!;
    return {
      account,
      accounts: accounts.filter((a) => a.connectionId === account.connectionId),
    };
  }

  public async discover(
    principal: ServiceTokenPrincipal,
    args: Record<string, unknown>,
  ) {
    try {
      const { account } = await this.context(
        principal,
        args,
        "get_connected_assets",
      );
      const [businesses, pages, health] = await Promise.all([
        this.providers.metaBusinesses(
          principal.workspaceId,
          account.connectionId,
        ),
        this.providers.metaPages(principal.workspaceId, account.connectionId),
        this.providers.readHealth(
          principal.workspaceId,
          account.connectionId,
          account.id,
        ),
      ]);
      return {
        account_id: account.externalAccountId,
        businesses,
        pages,
        health,
        data_status: "live",
        truncated: businesses.length >= 500 || pages.length >= 500,
      };
    } catch (error) {
      throw metaReadError(error, "get_connected_assets");
    }
  }

  public async call(
    principal: ServiceTokenPrincipal,
    operation: string,
    args: Record<string, unknown>,
  ) {
    let connectionId: string | undefined;
    try {
      const { account, accounts } = await this.context(
        principal,
        args,
        operation,
      );
      connectionId = account.connectionId;
      const workspace = principal.workspaceId,
        connection = account.connectionId;
      if (
        operation === "list_meta_pages" ||
        operation === "list_meta_businesses"
      ) {
        const items =
          operation === "list_meta_pages"
            ? await this.providers.metaPages(workspace, connection)
            : await this.providers.metaBusinesses(workspace, connection);
        return { items, truncated: items.length >= 500 };
      }
      const isBusiness = operation.includes("business");
      const id =
        args[isBusiness ? "business_id" : "page_id"] ??
        args[isBusiness ? "businessId" : "pageId"];
      if (typeof id !== "string" || !/^\d{1,40}$/.test(id))
        throw new MetaReadError("meta_invalid_parameters", operation);
      if (isBusiness) {
        const businesses = await this.providers.metaBusinesses(
          workspace,
          connection,
        );
        const business = businesses.find((b) => b.id === id);
        if (!business)
          throw new MetaReadError("meta_asset_not_accessible", operation);
        if (operation === "get_meta_business") return business;
        if (operation === "list_business_ad_accounts") {
          const allowed = new Set(
            accounts.map((a) => a.externalAccountId.replace(/^act_/, "")),
          );
          return (
            await this.providers.metaBusinessAdAccounts(
              workspace,
              connection,
              id,
            )
          ).filter((a) =>
            allowed.has(a.externalAccountId.replace(/^act_/, "")),
          );
        }
        const accessible = new Set(
          (await this.providers.metaPages(workspace, connection)).map(
            (p) => p.id,
          ),
        );
        return (
          await this.providers.metaBusinessPages(workspace, connection, id)
        ).filter((p) => accessible.has(p.id));
      }
      const pages = await this.providers.metaPages(workspace, connection);
      const page = pages.find((p) => p.id === id);
      if (!page)
        throw new MetaReadError("meta_asset_not_accessible", operation);
      if (operation === "get_meta_page") return page;
      if (
        operation === "get_page_post" ||
        operation === "get_page_post_engagement"
      ) {
        const postId = args.post_id ?? args.postId;
        if (
          typeof postId !== "string" ||
          !new RegExp(`^${id}_[0-9]{1,40}$`).test(postId)
        )
          throw new MetaReadError("meta_asset_not_accessible", operation);
        return await this.providers.metaPagePost(
          workspace,
          connection,
          id,
          postId,
        );
      }
      if (operation === "get_page_instagram_account")
        return await this.providers.metaInstagram(workspace, connection, id);
      const limit = args.limit ?? 25;
      if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100)
        throw new MetaReadError("meta_invalid_parameters", operation);
      const cursor = args.cursor;
      if (
        cursor !== undefined &&
        (typeof cursor !== "string" || !/^[A-Za-z0-9_=-]{1,2048}$/.test(cursor))
      )
        throw new MetaReadError("meta_invalid_parameters", operation);
      const posts = await this.providers.metaPagePosts(
        workspace,
        connection,
        id,
        Number(limit),
        typeof cursor === "string" ? cursor : undefined,
      );
      return posts;
    } catch (error) {
      const safe = metaReadError(error, operation);
      const requested =
        args.page_id ?? args.pageId ?? args.business_id ?? args.businessId;
      safe.context = {
        ...(connectionId ? { connectionId } : {}),
        assetType: operation.includes("business") ? "business" : "page",
        endpointCategory: operation.includes("post")
          ? "page_posts"
          : operation.includes("business")
            ? "business_assets"
            : "page_assets",
        ...(typeof requested === "string" && /^\d{1,40}$/.test(requested)
          ? { assetId: requested }
          : {}),
      };
      throw safe;
    }
  }
}
