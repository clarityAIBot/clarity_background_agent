import { relations } from "drizzle-orm/relations";
import { featureRequests, requestMessages, policies, userPolicies, users, sessions, agentSessions } from "./schema";

export const requestMessagesRelations = relations(requestMessages, ({one}) => ({
	featureRequest: one(featureRequests, {
		fields: [requestMessages.requestId],
		references: [featureRequests.requestId]
	}),
}));

export const featureRequestsRelations = relations(featureRequests, ({many}) => ({
	requestMessages: many(requestMessages),
	agentSessions: many(agentSessions),
}));

export const userPoliciesRelations = relations(userPolicies, ({one}) => ({
	policy: one(policies, {
		fields: [userPolicies.policyId],
		references: [policies.id]
	}),
	user: one(users, {
		fields: [userPolicies.userId],
		references: [users.id]
	}),
}));

export const policiesRelations = relations(policies, ({many}) => ({
	userPolicies: many(userPolicies),
}));

export const usersRelations = relations(users, ({many}) => ({
	userPolicies: many(userPolicies),
	sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({one}) => ({
	user: one(users, {
		fields: [sessions.userId],
		references: [users.id]
	}),
}));

export const agentSessionsRelations = relations(agentSessions, ({one}) => ({
	featureRequest: one(featureRequests, {
		fields: [agentSessions.requestId],
		references: [featureRequests.requestId]
	}),
}));