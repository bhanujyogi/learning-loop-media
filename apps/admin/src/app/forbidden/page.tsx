export default function Forbidden() {
  return (
    <main style={{ margin: '80px auto', maxWidth: 480 }}>
      <h1>Not authorized</h1>
      <p className="muted">
        Your account does not have a staff role. Access is granted by an administrator and enforced
        by the database.
      </p>
      <a href="/login">Sign in with a different account</a>
    </main>
  );
}
