// Section with Omit utility type
interface FullProps {
  id: string;
  name: string;
  email: string;
  password: string;
}

type Props = Omit<FullProps, "password">;

export default function WithOmit(props: Props) {
  return (
    <div>
      <span>{props.id}</span>
      <span>{props.name}</span>
      <span>{props.email}</span>
    </div>
  );
}
