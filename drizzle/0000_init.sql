CREATE TYPE "public"."entry_kind" AS ENUM('grade', 'cashout', 'admin_bonus', 'bp_reward');--> statement-breakpoint
CREATE TABLE "admin_unlock_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"ok" boolean NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bp_reward_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"season_id" integer NOT NULL,
	"reward_id" integer,
	"badge_number" smallint,
	"entry_id" integer,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bp_rewards" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"level" integer NOT NULL,
	"text" text NOT NULL,
	"type" text NOT NULL,
	"amount" integer,
	"badge_number" smallint
);
--> statement-breakpoint
CREATE TABLE "bp_seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"max_level" integer NOT NULL,
	"xp_per_level" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bp_task_completions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"season_id" integer NOT NULL,
	"task_id" integer,
	"xp" integer NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bp_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"target" double precision,
	"xp" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"sort_key" bigint NOT NULL,
	"kind" "entry_kind" NOT NULL,
	"subject" text NOT NULL,
	"grade" smallint,
	"grade_text" text,
	"reward" integer NOT NULL,
	"bonus_desc" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bp_reward_claims" ADD CONSTRAINT "bp_reward_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bp_reward_claims" ADD CONSTRAINT "bp_reward_claims_season_id_bp_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."bp_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bp_reward_claims" ADD CONSTRAINT "bp_reward_claims_reward_id_bp_rewards_id_fk" FOREIGN KEY ("reward_id") REFERENCES "public"."bp_rewards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bp_reward_claims" ADD CONSTRAINT "bp_reward_claims_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bp_rewards" ADD CONSTRAINT "bp_rewards_season_id_bp_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."bp_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bp_seasons" ADD CONSTRAINT "bp_seasons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bp_task_completions" ADD CONSTRAINT "bp_task_completions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bp_task_completions" ADD CONSTRAINT "bp_task_completions_season_id_bp_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."bp_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bp_task_completions" ADD CONSTRAINT "bp_task_completions_task_id_bp_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."bp_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bp_tasks" ADD CONSTRAINT "bp_tasks_season_id_bp_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."bp_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_unlock_attempts_user_at_idx" ON "admin_unlock_attempts" USING btree ("user_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "bp_reward_claims_reward_uq" ON "bp_reward_claims" USING btree ("user_id","reward_id");--> statement-breakpoint
CREATE INDEX "bp_seasons_user_idx" ON "bp_seasons" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bp_seasons_active_uq" ON "bp_seasons" USING btree ("user_id") WHERE "bp_seasons"."is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "bp_task_completions_task_uq" ON "bp_task_completions" USING btree ("user_id","task_id");--> statement-breakpoint
CREATE INDEX "entries_user_date_idx" ON "entries" USING btree ("user_id","date");