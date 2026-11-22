CREATE TABLE "ai_capabilities" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"system_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"notes" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"system_id" text NOT NULL,
	"risk_tier" text DEFAULT 'medium' NOT NULL,
	"approved_at" timestamp with time zone,
	"review_due_at" date,
	"target_users" integer,
	"conditions" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_profiles_system_id_unique" UNIQUE("system_id")
);
--> statement-breakpoint
CREATE TABLE "ai_request_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"request_id" text NOT NULL,
	"step_id" text,
	"user_id" text,
	"actor_label" text NOT NULL,
	"type" text NOT NULL,
	"comment" text,
	"conditions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_request_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"request_id" text NOT NULL,
	"stage_id" text,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"rule" text DEFAULT 'any' NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"activated_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"vendor" text,
	"url" text,
	"kind" text DEFAULT 'new_tool' NOT NULL,
	"system_id" text,
	"team_id" text,
	"requester_user_id" text,
	"capability" text NOT NULL,
	"business_case" text NOT NULL,
	"data_description" text,
	"expected_users" integer,
	"estimated_cost" text,
	"personal_data" boolean DEFAULT false NOT NULL,
	"confidential_data" boolean DEFAULT false NOT NULL,
	"write_access" boolean DEFAULT false NOT NULL,
	"autonomous" boolean DEFAULT false NOT NULL,
	"customer_facing" boolean DEFAULT false NOT NULL,
	"people_decisions" boolean DEFAULT false NOT NULL,
	"trains_on_data" text DEFAULT 'unknown' NOT NULL,
	"risk_tier" text NOT NULL,
	"status" text DEFAULT 'in_review' NOT NULL,
	"conditions" text,
	"result_system_id" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_review_stage_members" (
	"stage_id" text NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	CONSTRAINT "ai_review_stage_members_stage_id_user_id_pk" PRIMARY KEY("stage_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "ai_review_stages" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"position" integer NOT NULL,
	"rule" text DEFAULT 'any' NOT NULL,
	"min_tier" text DEFAULT 'low' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_team_rollouts" (
	"organization_id" text NOT NULL,
	"system_id" text NOT NULL,
	"team_id" text NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"adopted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_team_rollouts_system_id_team_id_pk" PRIMARY KEY("system_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "ai_usage_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"system_id" text NOT NULL,
	"recorded_on" date NOT NULL,
	"active_users" integer NOT NULL,
	"licensed_seats" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_capabilities" ADD CONSTRAINT "ai_capabilities_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_capabilities" ADD CONSTRAINT "ai_capabilities_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_capabilities" ADD CONSTRAINT "ai_capabilities_request_id_ai_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."ai_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_profiles" ADD CONSTRAINT "ai_profiles_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_profiles" ADD CONSTRAINT "ai_profiles_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_request_events" ADD CONSTRAINT "ai_request_events_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_request_events" ADD CONSTRAINT "ai_request_events_request_id_ai_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."ai_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_request_events" ADD CONSTRAINT "ai_request_events_step_id_ai_request_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."ai_request_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_request_events" ADD CONSTRAINT "ai_request_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_request_steps" ADD CONSTRAINT "ai_request_steps_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_request_steps" ADD CONSTRAINT "ai_request_steps_request_id_ai_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."ai_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_request_steps" ADD CONSTRAINT "ai_request_steps_stage_id_ai_review_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."ai_review_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_requester_user_id_user_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_result_system_id_systems_id_fk" FOREIGN KEY ("result_system_id") REFERENCES "public"."systems"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_stage_members" ADD CONSTRAINT "ai_review_stage_members_stage_id_ai_review_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."ai_review_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_stage_members" ADD CONSTRAINT "ai_review_stage_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_stage_members" ADD CONSTRAINT "ai_review_stage_members_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_stages" ADD CONSTRAINT "ai_review_stages_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_team_rollouts" ADD CONSTRAINT "ai_team_rollouts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_team_rollouts" ADD CONSTRAINT "ai_team_rollouts_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_team_rollouts" ADD CONSTRAINT "ai_team_rollouts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_snapshots" ADD CONSTRAINT "ai_usage_snapshots_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_snapshots" ADD CONSTRAINT "ai_usage_snapshots_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_capabilities_system_idx" ON "ai_capabilities" USING btree ("system_id");--> statement-breakpoint
CREATE INDEX "ai_profiles_org_idx" ON "ai_profiles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ai_request_events_request_idx" ON "ai_request_events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_request_steps_request_idx" ON "ai_request_steps" USING btree ("request_id","position");--> statement-breakpoint
CREATE INDEX "ai_requests_org_status_idx" ON "ai_requests" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "ai_requests_requester_idx" ON "ai_requests" USING btree ("requester_user_id");--> statement-breakpoint
CREATE INDEX "ai_stage_members_user_idx" ON "ai_review_stage_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_review_stages_org_idx" ON "ai_review_stages" USING btree ("organization_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_usage_system_day_idx" ON "ai_usage_snapshots" USING btree ("system_id","recorded_on");