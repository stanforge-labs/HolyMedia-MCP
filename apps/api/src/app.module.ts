import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuditService } from "./audit/audit.service.js";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { AuthenticationGuard } from "./auth/authentication.guard.js";
import { CookieService } from "./auth/cookie.service.js";
import { CsrfGuard } from "./auth/csrf.guard.js";
import { EmailService } from "./auth/email.service.js";
import { MeController } from "./auth/me.controller.js";
import { PasswordService } from "./auth/password.service.js";
import { SessionService } from "./auth/session.service.js";
import { HealthController } from "./health.controller.js";
import { DatabaseService } from "./infrastructure/database.service.js";
import { RedisRateLimitService } from "./infrastructure/redis-rate-limit.service.js";
import { ReadinessService } from "./readiness.service.js";
import { InvitationController } from "./workspaces/invitation.controller.js";
import { WorkspaceAuthorizationGuard } from "./auth/workspace-authorization.guard.js";
import { WorkspaceController } from "./workspaces/workspace.controller.js";
import { WorkspaceService } from "./workspaces/workspace.service.js";
import { ProviderController } from "./providers/provider.controller.js";
import { CredentialVaultService } from "./providers/credential-vault.service.js";
import { OAuthStateService } from "./providers/oauth-state.service.js";
import { ProviderRefreshCoordinator } from "./providers/refresh-coordinator.service.js";
import { ProviderRegistry } from "./providers/provider.registry.js";
import { ProviderService } from "./providers/provider.service.js";
import { ProviderMetricsService } from "./providers/provider.metrics.js";
import { ServiceTokenController } from "./service-tokens/service-token.controller.js";
import { ServiceTokenService } from "./service-tokens/service-token.service.js";
import { McpController } from "./mcp/mcp.controller.js";
import { McpService } from "./mcp/mcp.service.js";
import {
  LegacyAuthController,
  LegacyMeController,
} from "./compat/legacy-auth.controller.js";
import { LegacyMcpTokenController } from "./compat/legacy-mcp-token.controller.js";
import { LegacyHostedController } from "./compat/legacy-hosted.controller.js";
import { ReportController } from "./reports/report.controller.js";
import { ReportService } from "./reports/report.service.js";
import { LegacyReportController } from "./compat/legacy-report.controller.js";
import { LegacySiteAnalysisController } from "./compat/legacy-site-analysis.controller.js";
import { LegacyProfileController } from "./compat/legacy-profile.controller.js";
import { SiteAnalysisController } from "./site-analysis/site-analysis.controller.js";
import { SiteAnalysisService } from "./site-analysis/site-analysis.service.js";
import { SiteAuditController } from "./site-audits/site-audit.controller.js";
import { SiteAuditService } from "./site-audits/site-audit.service.js";
import { BillingController } from "./billing/billing.controller.js";
import { BillingService } from "./billing/billing.service.js";
import { ManualConnectionRequestController } from "./compat/manual-connection-request.controller.js";
import { ManualConnectionRequestService } from "./compat/manual-connection-request.service.js";
import { LegacyDiagnosticsController } from "./compat/legacy-diagnostics.controller.js";
import { SearchConsoleController } from "./seo/search-console.controller.js";
import { McpPreviewService } from "./mcp/mcp-preview.service.js";
import { McpPublicWriteService } from "./mcp/mcp-public-write.service.js";
import { McpPublicApprovalController } from "./mcp/mcp-public-approval.controller.js";
import { LegacyMcpOAuthController } from "./compat/legacy-mcp-oauth.controller.js";
import { McpOAuthClientService } from "./mcp/mcp-oauth-client.service.js";
import { OAuthAuthorizationService } from "./mcp/oauth-authorization.service.js";
import { OAuthClientMetadataService } from "./mcp/oauth-client-metadata.service.js";
import { OAuthMetadataController } from "./compat/oauth-metadata.controller.js";
import { LegacyGoogleLoginController } from "./compat/legacy-google-login.controller.js";
import { GoogleLoginService } from "./auth/google-login.service.js";
import { LegacyMetaSkillsController } from "./compat/legacy-meta-skills.controller.js";
import { ProductAnalyticsController } from "./analytics/product-analytics.controller.js";
import { ProductAnalyticsService } from "./analytics/product-analytics.service.js";
import { AdminController } from "./admin/admin.controller.js";
import { AdminAuthenticationGuard } from "./admin/admin-authentication.guard.js";
import { AdminService } from "./admin/admin.service.js";
import { SupportRequestController } from "./support/support-request.controller.js";
import { SupportRequestService } from "./support/support-request.service.js";

@Module({
  controllers: [
    HealthController,
    AuthController,
    MeController,
    WorkspaceController,
    InvitationController,
    ProviderController,
    ServiceTokenController,
    McpController,
    McpPublicApprovalController,
    LegacyAuthController,
    LegacyMeController,
    LegacyMcpTokenController,
    LegacyHostedController,
    ReportController,
    LegacyReportController,
    LegacySiteAnalysisController,
    LegacyProfileController,
    SiteAnalysisController,
    SiteAuditController,
    BillingController,
    ManualConnectionRequestController,
    LegacyDiagnosticsController,
    SearchConsoleController,
    LegacyMcpOAuthController,
    OAuthMetadataController,
    LegacyGoogleLoginController,
    LegacyMetaSkillsController,
    ProductAnalyticsController,
    AdminController,
    SupportRequestController,
  ],
  providers: [
    DatabaseService,
    ReadinessService,
    AuditService,
    AuthService,
    AuthenticationGuard,
    CookieService,
    EmailService,
    PasswordService,
    SessionService,
    RedisRateLimitService,
    WorkspaceAuthorizationGuard,
    WorkspaceService,
    CredentialVaultService,
    OAuthStateService,
    ProviderRefreshCoordinator,
    ProviderRegistry,
    ProviderService,
    ProviderMetricsService,
    ServiceTokenService,
    McpService,
    McpPreviewService,
    McpPublicWriteService,
    McpOAuthClientService,
    OAuthAuthorizationService,
    OAuthClientMetadataService,
    GoogleLoginService,
    ReportService,
    SiteAnalysisService,
    SiteAuditService,
    BillingService,
    ManualConnectionRequestService,
    ProductAnalyticsService,
    AdminService,
    AdminAuthenticationGuard,
    SupportRequestService,
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AppModule {}
