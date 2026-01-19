// The actual LoginPage island with Props interface
interface Props {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export default function LoginPage(props: Props) {
  return (
    <form>
      <input type="email" value={props.email} placeholder="Email" />
      <input type="password" value={props.password} placeholder="Password" />
      {props.rememberMe && <label><input type="checkbox" /> Remember me</label>}
      <button type="submit">Login</button>
    </form>
  );
}
