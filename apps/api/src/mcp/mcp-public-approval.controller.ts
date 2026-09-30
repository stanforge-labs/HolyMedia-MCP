import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import { CurrentPrincipal } from "../auth/auth.decorators.js";
import { CsrfGuard } from "../auth/csrf.guard.js";
import type { HumanPrincipal } from "../auth/auth.types.js";
import { McpPublicWriteService } from "./mcp-public-write.service.js";

@Controller("mcp/public/approval")
@UseGuards(AuthenticationGuard)
export class McpPublicApprovalController {
  public constructor(
    @Inject(McpPublicWriteService)
    private readonly writes: McpPublicWriteService,
  ) {}

  @Get()
  public view(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Query("approval") nonce: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header("cache-control", "no-store");
    reply.header("referrer-policy", "no-referrer");
    return this.writes.approvalView(principal, nonce);
  }

  @Post()
  @UseGuards(CsrfGuard)
  public decide(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (body.decision !== "approve" && body.decision !== "cancel")
      throw new BadRequestException("Invalid approval decision.");
    reply.header("cache-control", "no-store");
    return this.writes.decideApproval(
      principal,
      typeof body.approval === "string" ? body.approval : "",
      body.decision,
    );
  }
}
