import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type {
  ChatEndpointResponse,
  CreateProjectResponse,
  GenerateConceptsResponse,
  GenerateWorldResponse,
  ListProjectsResponse,
  ListWorldJobsResponse,
  PrepareWorldPromptResponse,
  Project,
  SaveWorldResponse,
} from '@ai-three-studio/shared';
import {
  ChatDto,
  CreateProjectDto,
  GenerateConceptsDto,
  GenerateWorldDto,
  PrepareWorldPromptDto,
  SaveWorldDto,
} from './dto';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  create(@Body() dto: CreateProjectDto): Promise<CreateProjectResponse> {
    return this.projects.createProject(dto);
  }

  @Get()
  list(): ListProjectsResponse {
    return this.projects.listProjects();
  }

  @Get('world-jobs')
  @Header('Cache-Control', 'no-store')
  listWorldJobs(): ListWorldJobsResponse {
    return this.projects.listWorldJobs();
  }

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string): Project {
    return this.projects.getProject(id);
  }

  @Post(':id/concepts')
  generateConcepts(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: GenerateConceptsDto,
  ): Promise<GenerateConceptsResponse> {
    return this.projects.generateConcepts(id, dto);
  }

  @Post(':id/world-prompt')
  @Header('Cache-Control', 'no-store')
  prepareWorldPrompt(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PrepareWorldPromptDto,
  ): Promise<PrepareWorldPromptResponse> {
    return this.projects.prepareWorldPrompt(id, dto);
  }

  @Post(':id/world')
  generateWorld(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: GenerateWorldDto,
  ): Promise<GenerateWorldResponse> {
    return this.projects.generateWorld(id, dto);
  }

  @Get(':id/world-jobs/:jobId')
  @Header('Cache-Control', 'no-store')
  getWorldJob(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('jobId', new ParseUUIDPipe()) jobId: string,
  ): GenerateWorldResponse {
    return this.projects.getWorldJob(id, jobId);
  }

  @Put(':id/world')
  saveWorld(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SaveWorldDto,
  ): Promise<SaveWorldResponse> {
    return this.projects.saveWorld(id, dto);
  }

  @Post(':id/chat')
  chat(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ChatDto,
  ): Promise<ChatEndpointResponse> {
    return this.projects.chat(id, dto);
  }

  @Get([':id/concepts/:conceptId/image', ':id/concepts/:conceptId/image.svg'])
  conceptImage(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('conceptId', new ParseUUIDPipe()) conceptId: string,
    @Res() response: Response,
  ): void {
    const artifact = this.projects.getConceptArtifact(id, conceptId);
    response.setHeader('Content-Type', artifact.mimeType === 'image/svg+xml'
      ? 'image/svg+xml; charset=utf-8' : artifact.mimeType);
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(artifact.encoding === 'base64' ? Buffer.from(artifact.data, 'base64') : artifact.data);
  }
}
