import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class CreateServiceTokenDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  public name!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(16)
  @IsString({ each: true })
  public scopes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  public accountIds?: string[];

  @IsOptional()
  @IsIn(["ALL_CONNECTED", "STATIC_ALLOWLIST"])
  public resourceAccessMode?: "ALL_CONNECTED" | "STATIC_ALLOWLIST";

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  public expiresInDays?: number;
}

export class RotateServiceTokenDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  public expiresInDays?: number;
}

export class UpdateServiceTokenDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  public name!: string;
}

export class UpdateServiceTokenScopesDto {
  @IsArray()
  @ArrayMaxSize(16)
  @IsString({ each: true })
  public scopes!: string[];
}
