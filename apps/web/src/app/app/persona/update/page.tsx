import Link from "next/link";
import { PersonaUpdateFlow } from "@/components/persona-update/persona-update-flow";
import { getDatabase } from "@/server/database";
import { ApplicationService } from "@/server/applications/service";
import { requireSessionUserPage } from "@/server/page-session";

export const dynamic = "force-dynamic";

export default async function PersonaUpdatePage() {
  const user = await requireSessionUserPage();
  const applications = new ApplicationService(getDatabase()).listApplications(
    user.id,
  );

  return (
    <div className="page">
      <p className="breadcrumb">
        <Link href="/app/persona">ペルソナへ戻る</Link>
      </p>
      <h1>ペルソナを更新</h1>
      <p className="page-lead">
        選考結果と振り返りから更新案を作成します。承認するまで現在のペルソナは変わりません。
      </p>
      <PersonaUpdateFlow
        applications={applications.map((application) => ({
          id: application.applicationId,
          label: `${application.company} — ${application.role}`,
        }))}
      />
    </div>
  );
}
