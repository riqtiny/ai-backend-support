import { Request } from "express";

export interface AuthenticatedOrganization {
  id: string;
  name: string;
}

export interface AuthenticatedRequest extends Request {
  organization: AuthenticatedOrganization;
}
