import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class OptionalAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.headers['x-api-key'] || request.query['token'];

    // 可选鉴权：如果有 token 则验证，没有则放行（公开接口）
    // 未来可扩展为 JWT 验证或与数据库比对
    if (token) {
      // TODO: 验证 token 有效性
      // 暂时简单校验非空
      if (typeof token === 'string' && token.length > 0) {
        (request as any).userId = token; // 临时：将 token 作为 userId
      }
    }

    return true;
  }
}

@Injectable()
export class RequiredAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.headers['x-api-key'] || request.query['token'];

    if (!token || typeof token !== 'string' || token.length === 0) {
      throw new UnauthorizedException('需要提供有效的认证凭证');
    }

    // TODO: 验证 token 有效性（JWT/数据库比对）
    (request as any).userId = token;
    return true;
  }
}
