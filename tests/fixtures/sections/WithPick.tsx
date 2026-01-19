// Section with Pick utility type
interface FullUser {
  id: string;
  name: string;
  email: string;
  password: string;
  createdAt: string;
}

type Props = Pick<FullUser, "id" | "name">;

export default function WithPick(props: Props) {
  return (
    <div>
      <span>{props.id}</span>
      <span>{props.name}</span>
    </div>
  );
}
