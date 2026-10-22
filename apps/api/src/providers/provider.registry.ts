import { Injectable } from "@nestjs/common";
import { loadConfig } from "@holymedia/config";
import type { ProviderDefinition, ProviderId } from "@holymedia/contracts";
import { ProviderError } from "./provider.errors.js";
import type {
  ProviderOAuthAdapter,
  ProviderRegistryEntry,
} from "./provider.types.js";
import { TestProviderAdapter } from "./adapters/test.provider.js";
import {
  GoogleAdsAdapter,
  googleAdsDefinition,
} from "./adapters/google.ads.js";
import { MetaAdsAdapter, metaAdsDefinition } from "./adapters/meta.ads.js";
import { TikTokAdsAdapter } from "./adapters/tiktok.ads.js";
import { YandexDirectAdapter } from "./adapters/yandex.direct.js";
import { GoogleSearchConsoleAdapter } from "./adapters/google.search-console.js";
import {
  GoogleAnalyticsAdapter,
  googleAnalyticsDefinition,
} from "./adapters/google.analytics.js";

@Injectable()
export class ProviderRegistry {
  private readonly config = loadConfig();
  private readonly entries: ProviderRegistryEntry[];

  public constructor() {
    const google = new GoogleAdsAdapter(this.config);
    const meta = new MetaAdsAdapter(this.config);
    const yandex = new YandexDirectAdapter(this.config);
    const tiktok = new TikTokAdsAdapter(this.config);
    const searchConsole = new GoogleSearchConsoleAdapter(this.config);
    const analytics = new GoogleAnalyticsAdapter(this.config);
    this.entries = [
      {
        definition: googleAdsDefinition(
          Boolean(google.definition.status === "available"),
          this.config.providerGoogleAdsWriteEnabled,
        ),
        adapter: google,
      },
      {
        definition: metaAdsDefinition(
          this.config,
          Boolean(meta.definition.status === "available"),
        ),
        adapter: meta,
      },
      { definition: yandex.definition, adapter: yandex },
      { definition: tiktok.definition, adapter: tiktok },
      {
        definition: searchConsole.definition,
        adapter: searchConsole,
      },
      {
        definition: googleAnalyticsDefinition(
          analytics.definition.status === "available",
        ),
        adapter: analytics,
      },
      {
        definition: testProviderDefinition(),
        adapter: new TestProviderAdapter(),
      },
    ];
  }

  public list(): ProviderDefinition[] {
    return this.entries
      .filter(({ definition }) =>
        this.config.environment === "production"
          ? definition.id !== "TEST_PROVIDER"
          : true,
      )
      .map(({ definition }) => definition);
  }

  public get(provider: ProviderId): ProviderRegistryEntry {
    if (
      provider === "TEST_PROVIDER" &&
      this.config.environment === "production"
    ) {
      throw new ProviderError(
        "provider_not_configured",
        "Test provider is not available.",
      );
    }
    const entry = this.entries.find(
      ({ definition }) => definition.id === provider,
    );
    if (!entry)
      throw new ProviderError(
        "provider_not_configured",
        "Provider is not supported.",
      );
    return entry;
  }

  public adapter(provider: ProviderId): ProviderOAuthAdapter {
    const entry = this.get(provider);
    if (!entry.adapter) {
      throw new ProviderError(
        "provider_not_configured",
        "Provider OAuth is not configured.",
      );
    }
    return entry.adapter;
  }
}

function testProviderDefinition(): ProviderDefinition {
  return {
    id: "TEST_PROVIDER",
    displayName: "Test Provider",
    oauth: true,
    pkce: true,
    accountDiscovery: true,
    refresh: true,
    read: true,
    write: false,
    status: "test_only",
    scopes: ["test.accounts.read"],
  };
}
