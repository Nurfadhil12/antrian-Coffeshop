import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateBaristaDto {
  @IsString({ message: 'Nama barista wajib diisi' })
  @MinLength(2, { message: 'Nama barista minimal 2 karakter' })
  @MaxLength(80, { message: 'Nama barista maksimal 80 karakter' })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Nomor telepon maksimal 20 karakter' })
  phone?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateBaristaDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Nama barista minimal 2 karakter' })
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ListBaristasQueryDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}
