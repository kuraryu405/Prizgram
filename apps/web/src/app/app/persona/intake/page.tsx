import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PersonaWizard } from "@/components/persona/persona-wizard";
import { getDatabase } from "@/server/database";
import { PERSONA_INTAKE_QUESTIONS } from "@/server/persona/questions";
import { PersonaService } from "@/server/persona/service";
import { requireSessionUserPage } from "@/server/page-session";

export const dynamic = "force-dynamic";

export default async function PersonaIntakePage() {
  const user = await requireSessionUserPage();
  const service = new PersonaService(getDatabase());
  if (service.latestPersona(user.id) !== undefined) {
    redirect("/app/persona");
  }
  const intake = (() => {
    try {
      return service.startIntake(user.id);
    } catch {
      notFound();
    }
  })();

  return (
    <div className="page">
      <p className="breadcrumb">
        <Link href="/app/persona">ペルソナへ戻る</Link>
      </p>
      <h1>ペルソナ・ヒアリング</h1>
      <p className="page-lead">
        6つの質問に答えると、回答だけを根拠にペルソナを生成します。推測は行いません。
      </p>
      <PersonaWizard
        intakeId={intake.intakeId}
        initialAnswers={intake.answers}
        questions={PERSONA_INTAKE_QUESTIONS.map((question) => ({
          id: question.id,
          label: question.label,
          prompt: question.prompt,
          maxLength: question.maxLength,
        }))}
      />
    </div>
  );
}
